"""Talking to the automation database, shared by the scripts beside this file.

Not used by Ansible -- the roles read secrets through lookup_plugins/keepass.py,
which cannot prompt because it runs inside a forked worker. These are ordinary
interactive tools, so they can ask.
"""

import getpass
import os
import pathlib
import shutil
import subprocess
import sys

def _inventory():
    """The same three values the lookup plugin reads, from the same file.

    These scripts are not Ansible and cannot ask it for a variable, so they read
    group_vars/all.yml directly rather than keeping a second copy of the paths
    that would drift from it.
    """
    defaults = {
        "keepass_db": "~/Dropbox/automation.kdbx",
        "keepass_keyfile": None,
        "keepass_group": "nas-next",
    }
    path = pathlib.Path(__file__).resolve().parent.parent / "inventory" / "group_vars" / "all.yml"
    try:
        import yaml

        loaded = yaml.safe_load(path.read_text()) or {}
    except Exception:
        loaded = {}
    return {k: loaded.get(k, v) for k, v in defaults.items()}


_INVENTORY = _inventory()
DB = pathlib.Path(os.environ.get("NAS_SECRETS_DB", _INVENTORY["keepass_db"])).expanduser()
# Optional; passed only when it exists. See lookup_plugins/keepass.py.
_KEYFILE = os.environ.get("NAS_SECRETS_KEYFILE") or _INVENTORY["keepass_keyfile"]
KEYFILE = pathlib.Path(_KEYFILE).expanduser() if _KEYFILE else None
GROUP = _INVENTORY["keepass_group"]

_PASSPHRASE = None
_CLI = None


def cli():
    global _CLI
    if _CLI is None:
        if shutil.which("keepassxc-cli"):
            _CLI = ["keepassxc-cli"]
        elif shutil.which("flatpak") and subprocess.run(
            ["flatpak", "info", "org.keepassxc.KeePassXC"], capture_output=True
        ).returncode == 0:
            _CLI = ["flatpak", "run", "--command=keepassxc-cli", "org.keepassxc.KeePassXC"]
        else:
            sys.exit("keepassxc-cli not found: sudo apt install keepassxc")
    return _CLI


def passphrase():
    global _PASSPHRASE
    if _PASSPHRASE is None:
        if not DB.exists():
            sys.exit(f"{DB} does not exist")
        _PASSPHRASE = os.environ.get("NAS_SECRETS_PASSPHRASE") or getpass.getpass(
            f"Passphrase for {DB.name}: "
        )
    return _PASSPHRASE


def run(args, extra_stdin=None):
    """One keepassxc-cli call. The passphrase is always the first line of stdin."""
    key = ["-k", str(KEYFILE)] if KEYFILE and KEYFILE.exists() else []
    payload = passphrase() + "\n" + "".join(l + "\n" for l in (extra_stdin or []))
    return subprocess.run(
        [*cli(), args[0], "-q", *key, str(DB), *args[1:]],
        input=payload, text=True, capture_output=True,
    )


def checked(args, extra_stdin=None):
    done = run(args, extra_stdin)
    if done.returncode != 0:
        sys.exit(f"keepassxc-cli {args[0]}: {(done.stderr or done.stdout).strip()}")
    return done


def get(entry):
    """The Password field of an entry below the nas-next group, or None."""
    done = run(["show", "-s", "-a", "Password", f"{GROUP}/{entry}"])
    if done.returncode != 0:
        return None
    return done.stdout.rstrip("\n") or None


def put(entry, value, notes=None):
    """Create or replace an entry, keeping its value in the Password field."""
    parent = str(pathlib.PurePath(f"{GROUP}/{entry}").parent)
    for depth in range(len(pathlib.PurePath(parent).parts)):
        run(["mkdir", "/".join(pathlib.PurePath(parent).parts[: depth + 1])])
    run(["rm", f"{GROUP}/{entry}"])
    args = ["add", f"{GROUP}/{entry}", "-p"]
    if notes:
        args += ["--notes", notes]
    checked(args, [value])


def attach(entry, source, notes=None):
    """Store a file as an attachment on an entry, named after the file."""
    parent = str(pathlib.PurePath(f"{GROUP}/{entry}").parent)
    for depth in range(len(pathlib.PurePath(parent).parts)):
        run(["mkdir", "/".join(pathlib.PurePath(parent).parts[: depth + 1])])
    run(["rm", f"{GROUP}/{entry}"])
    args = ["add", f"{GROUP}/{entry}"]
    if notes:
        args += ["--notes", notes]
    checked(args)
    name = pathlib.PurePath(entry).name
    checked(["attachment-import", f"{GROUP}/{entry}", name, str(source)])


def remove(entry):
    return run(["rm", f"{GROUP}/{entry}"]).returncode == 0


def entries(group):
    """Entry names directly inside a group; groups end in / and are skipped."""
    done = run(["ls", f"{GROUP}/{group}"])
    if done.returncode != 0:
        return []
    # keepassxc-cli prints "[empty]" for a group with nothing in it, and ends
    # group names with a slash. Neither is an entry.
    return sorted(
        line.strip() for line in done.stdout.splitlines()
        if line.strip() and line.strip() != "[empty]"
        and not line.strip().endswith("/")
    )
