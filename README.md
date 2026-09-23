# nas-next

Ansible configuration for a single Proxmox VE host and the LXC containers on it.

One tool, and two things to hold: an SSH key authorised for **root** on the hypervisor, and the passphrase to the database every secret is read from.

## Use

```sh
make check     # ansible-lint, then access and readiness; changes nothing
make host      # converge the hypervisor
make tenants   # create and configure the containers
```

`make tenants TENANT=nas` limits a run to one tenant.

Both converges ask for the database passphrase once, and read every secret from it directly. Nothing is written to disk.

## Setup

Requires a Proxmox VE host reachable as `proxmox` in `~/.ssh/config`, as root, with `~/.ssh/nas-ansible` authorised:

```sshconfig
Host proxmox
    HostName 192.168.0.12
    User root
    IdentityFile ~/.ssh/nas-ansible
    IdentitiesOnly yes
```

Then, once. The series rather than a patch release: `requirements.txt` is hash-locked, so what lands in the virtualenv is the same whichever 3.11.x interprets it.

```sh
pyenv install --skip-existing 3.11
pyenv virtualenv 3.11 nas-next
pip install --require-hashes -r requirements.txt
ansible-galaxy collection install -r requirements.yml
```

## Hardware

An Intel N100 board in a micro-ATX case: four 2.5G NICs, seven SATA ports, one SODIMM slot, and an out-of-band KVM so the machine can be recovered without carrying a monitor to it.

| part | model | listing |
|---|---|---|
| board | HKUXZR N100 Industrial -- 4x i226 2.5G, 6x SATA, 2x M.2 | [B0CQZH8X2P](https://www.amazon.com/dp/B0CQZH8X2P) |
| memory | HP X1 32GB DDR5-4800 SODIMM CL40, `6H311AA#ABB` | [B0BV8QHBG7](https://www.amazon.com/dp/B0BV8QHBG7) |
| boot | Silicon Power 256GB NVMe M.2 2280, `SP256GBP34A60M28` | [B07ZGK3K4V](https://www.amazon.com/dp/B07ZGK3K4V) |
| pool | 2x Silicon Power A55 4TB SATA 2.5", `SP004TBSS3A55S25` | [B0BVLRFFWQ](https://www.amazon.com/dp/B0BVLRFFWQ) |
| case | micro-ATX, standard ATX PSU, USB 3.0 front I/O | [B0DWMRP174](https://www.amazon.com/dp/B0DWMRP174) |
| kvm | Sipeed NanoKVM -- RISC-V C906, HDMI + USB + 100M | [B0DWMHTB8D](https://www.amazon.com/dp/B0DWMHTB8D) |

## What runs where

Tenants are unprivileged containers on DHCP with reserved addresses. Five names answer on port 80 through the proxy; the rest are reached on their own ports.

| tenant | address | reached as |
|---|---|---|
| blocky | .40 | DNS for the LAN, and `*.home` |
| nas | .41 | SMB shares |
| jellyfin | .42 | `jellyfin.home`, `tv.` on the public domain |
| qbittorrent | .43 | `qbittorrent.home`, egress over WireGuard |
| site | .44 | the public domain itself |
| wireguard | .45 | `home.` on the public domain, UDP 51820 |
| immich | .46 | `photos.home`, `photos.` on the public domain |
| proxy | .47 | the names above |
| miniflux | .48 | `rss.home`, `rss.` on the public domain |
| gatus | .49 | `health.home` |

Public names reach this house two different ways.

The apex, `photos.` and `rss.` go through **Cloudflare tunnels**, which dial out — no port is forwarded and the addresses stay hidden behind Cloudflare's.

`tv.` does not. Cloudflare's terms restrict proxying video, and every other name depends on that account, so Jellyfin is served **directly**: a DNS-only record, 443 forwarded to the proxy, and a Let's Encrypt certificate issued over DNS-01.

**Only 443 is forwarded, never 80.** The `.home` names are matched by Host header, and a Host header is just text anyone can send — a forwarded 80 would otherwise publish every LAN service to the internet. Two things stop it: the rule that 80 stays unforwarded, and, as a floor under it, the proxy serves the `.home` vhosts only to plain LAN sources — the gateway and anything off-subnet are dropped, so a mistaken forward reaches nothing. On 443 exactly one name is served and everything else has its connection closed.

WireGuard needs its own forward, UDP 51820, and is the other name that must stay DNS-only: the proxy carries HTTP, not UDP.

## Layout

```
inventory/
  hosts.yml              the hypervisor, and the tenants
  group_vars/pve.yml     every ZFS dataset, and what is backed up
  host_vars/<tenant>.yml a tenant's container: vmid, size, mounts, devices
playbooks/               check, host, tenants
roles/
  pve_repos              enterprise repos off, no-subscription on
  pve_kernel             host kernel and microcode
  pve_ssh                hypervisor sshd policy, management key, red prompt
  pve_storage            creates the datasets, owns the share tree
  pve_backup             documents and photos to Backblaze B2, nightly
  pve_ddns               the `home` record follows this site's address
  lxc                    creates a container, starts it, finds its address
  tenant_ssh             hardens a container's sshd
  samba, jellyfin, blocky, qbittorrent, immich, miniflux, site
  proxy                  every LAN name on port 80, and tv. on 443
  wireguard              the way back onto the LAN from outside
  gatus                  health checks, at health.home
lookup_plugins/
  keepass.py             reads secrets from the database at converge time
scripts/
  with-secrets           asks for the passphrase, once, before ansible forks
  secret                 put a secret into the database, or take one out
  wg-client              create and remove WireGuard clients
```

**Data lives in inventory; mechanism lives in roles.** A tenant's vmid, mounts and network are written out in its own `host_vars` file, not hidden behind a map or a loop.

## Secrets

Credentials live in a KeePassXC database — `keepass_db` in `inventory/group_vars/all.yml`. Roles read them during a converge; nothing is written to disk, and nothing in this repository names anything but an entry.

The database also holds three things that are not credentials but identify this installation, under the **`identity`** group: `domain`, `email` and `mail-to`. They are there so the repository can be published. A domain resolves to this house's address, and this repository describes exactly what is listening at it and on which ports — committing the two together is the disclosure, not either alone. Roles derive their public names from `public_domain` rather than naming a zone, so the three Cloudflare tunnel ids are held the same way.

### Adding one

```sh
./scripts/secret add jellyfin/api-key            # type the value, twice
./scripts/secret add wireguard/wg0.conf --file wg0.conf  # store a file
./scripts/secret list jellyfin
./scripts/secret rm jellyfin/api-key
```

Then read it in the role, by the same name:

```yaml
lookup('keepass', 'jellyfin/api-key')
```

A named attribute instead of the password, for an entry that carries one -- qBittorrent stores its web password as a hash, under `PBKDF2`: `lookup('keepass', 'qbittorrent/password.txt', attr='PBKDF2')`. The entry names in a group: `query('keepass', 'wireguard-server/clients', list=true)`.

The entry is created under the **`nas-next`** group, in a subgroup named for the role that reads it. A typed value lands in the **Password** field; a file becomes an **attachment** named after the last part of the entry.

The GUI does the same job, and has to for the one thing the command line cannot reach: **custom attributes**. `keepassxc-cli edit` only touches title, username, url, notes and password.

A missing entry fails the converge naming the entry, so roles need no checks of their own.

```sh
make secrets-check     # every entry is readable
```

WireGuard clients are the exception, because they are generated rather than typed: `scripts/wg-client add <name>` writes them into the database itself.

One credential has no other copy: the **restic repository password**. Without it the backups in B2 cannot be read by anyone, Backblaze included.

## Tenants

Ansible creates a container with `pct` on the hypervisor, waits for its address, and configures it over SSH.

Adding a tenant is a `host_vars/<name>.yml` describing the container, a role holding what runs inside it, an entry in `hosts.yml`, and a play in `playbooks/tenants.yml`.

A tenant you do not want built sets `tenant_enabled: false` in its own `host_vars`. The play then ends before any role runs, so nothing is created — and unlike commenting it out of `hosts.yml`, the host still exists for `make tenants TENANT=…` and for anything else reading the inventory.

Removing one is two deliberate steps: delete the role and the inventory entry, then destroy the container by hand. Tenant data is on bind mounts, which Proxmox never deletes — only the container's root disk goes.
