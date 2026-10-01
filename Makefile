# Three targets. Everything runs as root over one SSH key; there is no API
# client, no token and no state.

SHELL := /bin/sh
.DEFAULT_GOAL := help

PYENV_ROOT ?= $(shell pyenv root 2>/dev/null || echo $$HOME/.pyenv)
BIN        := $(PYENV_ROOT)/versions/$(shell cat .python-version)/bin

# Limit a run to one tenant:  make tenants TENANT=samba
TENANT ?=
LIMIT  := $(if $(TENANT),--limit $(TENANT),)

.PHONY: help
help: ## Show this help
	@echo "nas-next -- make <target>"
	@echo
	@awk 'BEGIN {FS = ":.*## "} /^[a-z-]+:.*## / {printf "  \033[1m%-10s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)
	@echo
	@echo '  TENANT=<name>  limit "make tenants" to one tenant'
	@echo '  TAGS=<tags>    run only the tagged parts; TENANT=site TAGS=content'
	@echo '                 publishes the site files and nothing else'

.PHONY: check
check: ## Verify every access and every static check; changes nothing
	$(BIN)/ansible-lint --offline
	$(BIN)/ansible-playbook playbooks/check.yml
	@printf '\nchecks passed: lint, host access and readiness\n'

# Both converges read their secrets from the KeePassXC database. The wrapper
# asks for the passphrase once, before ansible forks a worker -- a worker has no
# stdin to prompt on, so this cannot happen any later.
.PHONY: host
host: ## Converge the Proxmox host (safe to re-run; TAGS=mail for one part)
	scripts/with-secrets $(BIN)/ansible-playbook playbooks/host.yml $(if $(TAGS),--tags $(TAGS))

.PHONY: tenants
tenants: ## Create and configure the tenant containers (TAGS=content: site files only)
	scripts/with-secrets $(BIN)/ansible-playbook playbooks/tenants.yml $(LIMIT) $(if $(TAGS),--tags $(TAGS))

.PHONY: secrets-check
secrets-check: ## Prove every secret is readable from the database
	scripts/with-secrets $(BIN)/ansible-playbook playbooks/secrets-check.yml

# The projects page, built from roles/site/files/projects/ exactly as a converge
# builds it, into a throwaway directory, and served on the loopback until ^C.
# The links point back at the preview rather than at the public zone, which this
# repository does not name; GitHub and LinkedIn come from the role's defaults.
PORT ?= 8000
DEFAULTS := roles/site/defaults/main.yml
default   = $(shell $(BIN)/python -c "import yaml; print(yaml.safe_load(open('$(DEFAULTS)'))['$(1)'])")

.PHONY: projects
projects: ## Preview the projects page on 127.0.0.1:$PORT (default 8000)
	@out=$$(mktemp -d); trap 'rm -rf "$$out"' EXIT; \
	$(BIN)/python roles/site/files/projects/build.py "$$out/site" \
		--home http://127.0.0.1:$(PORT)/ --projects http://127.0.0.1:$(PORT)/ \
		--github $(call default,site_github_url) --linkedin $(call default,site_linkedin_url) && \
	$(BIN)/python -m http.server $(PORT) --bind 127.0.0.1 --directory "$$out/site"
