# Reads secrets straight out of the KeePassXC database, so they never land on
# disk at all.
#
# A lookup plugin runs in the controller process, not on the target and not in a
# forked worker, so it can ask for the passphrase once and keep it in memory for
# the rest of the run. That is the whole reason this exists: the alternative was
# writing every secret into ~/.config/nas-next before a converge and deleting it
# afterwards, which leaves a window where they are ordinary files.
#
# Nothing here is cached to disk and nothing is logged. Tasks that consume these
# values should still carry no_log, because it is the task result that would
# otherwise be printed, not the lookup.

from __future__ import annotations

DOCUMENTATION = """
name: keepass
short_description: Read a secret from the automation KeePassXC database
description:
  - Returns the Password field of an entry, a named attribute of it, or the
    contents of its attachment.
  - The passphrase is asked for once per run and held in memory.
options:
  db:
    description: Path to the KeePassXC database.
    type: path
    default: ~/Dropbox/automation.kdbx
    vars:
      - name: keepass_db
    env:
      - name: NAS_SECRETS_DB
  keyfile:
    description:
      - Optional key file, as a second factor alongside the passphrase.
      - Null, or a path that does not exist, means the passphrase alone.
    type: str
    default: null
    vars:
      - name: keepass_keyfile
    env:
      - name: NAS_SECRETS_KEYFILE
  group:
    description: The group every entry sits under.
    type: str
    default: nas-next
    vars:
      - name: keepass_group
  _terms:
    description: Entry paths below the C(nas-next) group, e.g. C(miniflux/db-password.txt).
    required: true
  attr:
    description: Read this attribute instead of the Password field.
    type: str
  list:
    description:
      - Return the names of the entries in the group named by the term, rather
        than a secret. Used where something has to enumerate what exists --
        WireGuard peers, for instance -- which previously meant globbing a
        directory.
    type: bool
    default: false
"""

EXAMPLES = """
- name: A password
  ansible.builtin.debug:
    msg: "{{ lookup('keepass', 'miniflux/db-password.txt') }}"

- name: A stored derivation, computed once when the secret was set
  ansible.builtin.debug:
    msg: "{{ lookup('keepass', 'qbittorrent/password.txt', attr='PBKDF2') }}"

- name: A whole file, kept as an attachment
  ansible.builtin.debug:
    msg: "{{ lookup('keepass', 'wireguard/wg0.conf') }}"
"""

RETURN = """
_raw:
  description: The secret, as text.
  type: list
  elements: str
"""

import os
import pathlib
import shutil
import subprocess

from ansible.errors import AnsibleError
from ansible.plugins.lookup import LookupBase

# Set from the plugin's options on every call, which resolve from inventory
# (keepass_db and friends in group_vars/all.yml), then the environment, then the
# defaults declared above.
DB = None
KEYFILE = None
GROUP = "nas-next"

# Held for the life of the controller process: one prompt, however many lookups.
_PASSPHRASE = None
_VALUES: dict[tuple[str, str | None], str] = {}
_CLI = None


def _cli():
    global _CLI
    if _CLI is None:
        if shutil.which("keepassxc-cli"):
            _CLI = ["keepassxc-cli"]
        elif shutil.which("flatpak") and subprocess.run(
            ["flatpak", "info", "org.keepassxc.KeePassXC"],
            capture_output=True,
        ).returncode == 0:
            _CLI = ["flatpak", "run", "--command=keepassxc-cli",
                    "org.keepassxc.KeePassXC"]
        else:
            raise AnsibleError(
                "keepassxc-cli not found: sudo apt install keepassxc, or "
                "flatpak install flathub org.keepassxc.KeePassXC"
            )
    return _CLI


def _passphrase():
    """The passphrase, from the environment.

    Not a prompt. Task arguments are templated in a forked worker, which has no
    usable stdin, and each fork carries its own copy of this module -- so a
    prompt here would fail, and a cache here would not be shared. It is asked
    for once by scripts/with-secrets, before anything forks.
    """
    global _PASSPHRASE
    if _PASSPHRASE is None:
        if not DB.exists():
            raise AnsibleError(f"{DB} does not exist")
        _PASSPHRASE = os.environ.get("NAS_SECRETS_PASSPHRASE")
        if not _PASSPHRASE:
            raise AnsibleError(
                "NAS_SECRETS_PASSPHRASE is not set. Run this through the "
                "Makefile, or wrap it: scripts/with-secrets <command>"
            )
    return _PASSPHRASE


def _keepassxc(args):
    key = ["-k", str(KEYFILE)] if KEYFILE and KEYFILE.exists() else []
    return subprocess.run(
        [*_cli(), args[0], "-q", *key, str(DB), *args[1:]],
        input=_passphrase() + "\n",
        text=True,
        capture_output=True,
    )


def _fetch(entry, attr):
    path = f"{GROUP}/{entry}"

    if attr:
        done = _keepassxc(["show", "-s", "-a", attr, path])
        if done.returncode != 0:
            raise AnsibleError(
                f"keepass: no attribute {attr!r} on {path!r} "
                f"in {DB.name}: {done.stderr.strip()}"
            )
        return done.stdout.rstrip("\n")

    done = _keepassxc(["show", "-s", "-a", "Password", path])
    if done.returncode == 0 and done.stdout.strip():
        return done.stdout.rstrip("\n")

    # No password on the entry: it keeps its value as an attachment, named
    # after the file it came from.
    #
    # Exported to /dev/stdout rather than to a temporary file, so the contents
    # only ever exist in a pipe. A file would have to live somewhere the
    # keepassxc flatpak can reach -- its sandbox has its own /dev/shm, and /tmp
    # here is on the root disk -- which would mean writing the secret out, which
    # is the thing this plugin exists to avoid.
    name = pathlib.PurePath(entry).name
    export = _keepassxc(["attachment-export", path, name, "/dev/stdout"])
    if export.returncode != 0:
        raise AnsibleError(
            f"keepass: {path!r} has neither a Password nor an attachment "
            f"named {name!r} in {DB.name}: "
            f"{(export.stderr or done.stderr).strip()}"
        )
    return export.stdout


def _entries(group):
    """The entry names directly inside a group."""
    done = _keepassxc(["ls", f"{GROUP}/{group}"])
    if done.returncode != 0:
        raise AnsibleError(
            f"keepass: cannot list {GROUP}/{group!r} in {DB.name}: "
            f"{done.stderr.strip()}"
        )
    # Groups come back with a trailing slash; an empty group prints "[empty]".
    # Neither is an entry.
    return sorted(
        line.strip() for line in done.stdout.splitlines()
        if line.strip() and line.strip() != "[empty]"
        and not line.strip().endswith("/")
    )


class LookupModule(LookupBase):
    def run(self, terms, variables=None, **kwargs):
        # Resolve db/keyfile/group from inventory, the environment, or the
        # declared defaults -- in that order -- before anything reads them.
        self.set_options(var_options=variables, direct=kwargs)
        global DB, KEYFILE, GROUP
        DB = pathlib.Path(self.get_option("db")).expanduser()
        keyfile = self.get_option("keyfile")
        KEYFILE = pathlib.Path(keyfile).expanduser() if keyfile else None
        GROUP = self.get_option("group")

        attr = kwargs.get("attr")
        if kwargs.get("list"):
            # Flat, so query() yields the names themselves rather than a list
            # holding one list of them.
            names = []
            for term in terms:
                names.extend(_entries(term.rstrip("/")))
            return names
        results = []
        for term in terms:
            cached = _VALUES.get((term, attr))
            if cached is None:
                cached = _fetch(term, attr)
                _VALUES[(term, attr)] = cached
            results.append(cached)
        return results
