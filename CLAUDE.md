# nas-next

Ansible manages a Proxmox VE host and the LXC containers on it.

## How it runs

```sh
make check     # ansible-lint, then access and readiness; changes nothing
make host      # converge the hypervisor
make tenants   # create and configure containers  (TENANT=nas to limit)
```

Do not hand-assemble `ansible-playbook` invocations; use the targets.

**Everything runs as root** — connecting to the hypervisor as root over `~/.ssh/nas-ansible`, and as root inside containers. There is no `ansible` account, no sudo, and no privilege escalation. That is deliberate: `pct` is root-only and Proxmox's bind-mount check demands literally `root@pam`, so an unprivileged account would only add an indirection that has to be undone.

## Data in inventory, mechanism in roles

- A **dataset** is declared in `inventory/group_vars/pve.yml`.
- A **container** — vmid, cores, memory, disk, mounts, devices — is declared in `inventory/host_vars/<tenant>.yml`.
- A **role** holds behaviour, never per-tenant values.

Do not introduce a tenant map or a `for_each` over tenants. Each tenant's values are written out where that tenant is described, so reading one file tells you everything about it and changing one tenant cannot affect another.

## Secrets: ask, do not invent

Credentials live in a KeePassXC database and are read at converge time by `lookup('keepass', '<group>/<entry>')`. There is no secrets directory.

So do the values that name this installation, under `identity/`: the public zone and the two mail addresses, with the Cloudflare tunnel ids beside the role that uses each. They are not secrets, and this repository is publishable only because they are not in it -- a name resolving to this address, beside a description of everything listening at it, is a map. **Never write a domain, a mail address or a tunnel id into a role.** Public names are derived from `public_domain`, so a role spells out a subdomain and never a zone.

**When a role needs a secret that does not exist yet, ask for it.** Say which entry is needed and what it is for, and let the human create it in KeePassXC. Do not generate one, do not write one to a file, do not put one in a variable "for now". A password invented here is one the human never chose, cannot find in their password manager, and does not know exists.

The rest follows from that:

- **Never print a secret.** Not in output, not in a commit message, not to show it worked. Print a length, a checksum prefix, or nothing.
- **Never pass one as a command argument** -- argv is readable from `ps` by every user on the machine. Use `stdin:`.
- Tasks that consume one carry `no_log: true`.
- A missing entry fails the converge naming itself, so roles need no `stat` guards or `assert` pairs of their own.

`scripts/wg-client` generates rather than asks, because WireGuard keys are derived rather than chosen, and writes them straight into the database. `scripts/secret` will generate too, but only when told to with `--generate`, and that flag is for values that are genuinely arbitrary -- not for a password somebody has to be able to find later.

## Target state only

The Makefile and the roles describe what the infrastructure should **be** and converge on it. One-time transitions — migrating a directory into a dataset, a cutover — are done by hand and left out of the automation.

The test: **if running it twice is wrong, it does not belong in a role.**

## Verify against the system, not the exit code

A command that returned 0 is not evidence. Check the thing itself: that the account exists, that sshd's *effective* config says what you think, that the share is actually served.

## Conventions

- Commit only when asked. Otherwise leave changes staged and say what is staged.
- `ansible-lint` must pass at the **production** profile.
- Role variables need the role name as a prefix, or ansible-lint rejects them — which is part of why per-tenant values live in inventory instead.
- Connection details belong in `~/.ssh/config`, never in the inventory.
- Ansible group is `pve`, host is `proxmox`; a group and a host cannot share a name.
- A tenant that should not be built sets `tenant_enabled: false` in its own `host_vars`, rather than being commented out of `hosts.yml`.
- **Only 443 is forwarded from the router, never 80.** The proxy matches LAN names by Host header, and a Host header is just text anyone can send, so a forwarded 80 would otherwise publish every `.home` service to the internet. The `.home` vhosts on `:80` refuse any source that is not a plain LAN host — a `geo` allow-list drops the gateway and everything off-subnet with `444`, so a mistaken forward serves nothing — but that is a floor under the rule, not a reason to relax it: keep 80 unforwarded. Anything new that needs to be public becomes another `server` block on the proxy — there is one address and one forward, and that does not change.

## Proxmox facts worth knowing

- **Bind mounts and device passthrough are refused for every API credential**, including a `root@pam` token with every privilege. The guard in `/usr/share/perl5/PVE/LXC.pm` is `return 1 if $authuser eq 'root@pam'` — an exact string match, and a token authenticates as `root@pam!name`. Only `pct` on the host qualifies. This is the single fact the whole design follows from.
- **Container-wide `lxc.idmap` has no API at all.** It is raw LXC config, so it is written into `/etc/pve/lxc/<vmid>.conf` directly.
- **`/root/.ssh/authorized_keys` is a symlink to `/etc/pve/priv/authorized_keys`** and holds the node's own key, used for migration, cluster operations and the web UI shell. Never manage it with `exclusive: true`.
- **The container template ships sshd enabled**, so a container boots with it listening. Harden it as the first thing after start.
- **A container's address is discoverable from the host** — `lxc-info -n <vmid> -iH`, or `GET /nodes/{node}/lxc/{vmid}/interfaces`. No guest agent needed for LXC. This is why tenants can run DHCP.
- **Proxmox's Debian base ships no `sudo`.** Nothing here needs it.
- **`pveam` wants the full template filename**, not the series name, and the version in it moves.
- **The web UI writes `/etc/apt/sources.list.d/proxmox.sources`**; `pve_repos` targets that same file so it stays a no-op rather than creating a duplicate.
- **Creating a dataset over a populated directory hides the data** rather than losing it: the mount shadows the tree, the share reads empty, and writes fill the new dataset while the old content consumes space nothing can see. `pve_storage` refuses to do this.

## The pool

`tank`, a two-disk mirror.

What is protected and what is not is a per-dataset decision. `documents`, `photos` and `immich` carry `com.sun:auto-snapshot`, so zfs-auto-snapshot keeps frequent, hourly, daily, weekly and monthly snapshots of those three; the media datasets carry none, because they are re-acquirable. `documents` and `photos` also go offsite to B2 nightly through restic; `immich`, though snapshotted, does not. `restic-verify` restores from B2 weekly and compares byte for byte -- a backup nobody restores from is a guess. Container filesystems are a separate lineage: vzdump dumps them nightly onto `tank/backup`, which is why that dataset is not snapshotted -- a snapshot of a backup directory pins every dump ever taken.

The pool scrubs monthly, and smartd runs a short self-test on the disks nightly and a long one on the 15th.

The share tree is owned `65534:65534`, mode `0775`/`0664`, and every tenant maps 65534 through unshifted so a container's writes land with that same ownership. This convention is shared: a tenant mapping differently would see the same files owned by an id it cannot write.

Datasets are `lz4`, which buys little on already-compressed media -- do not promise space savings from compression here. `recordsize` is a **maximum**, not a fixed block size: a 4K file in a 1M dataset occupies one small block.

Tenants may share a mount, and two do — `movies`, `shows`, `drone` and `photos` are held by both `nas` and `jellyfin`. A bind mount has no exclusivity. Two consequences: access mode is per tenant, so a film deletable through Jellyfin may be read-only over SMB; and there is no cross-container locking, which is why `documents` is mounted by `nas` alone.
