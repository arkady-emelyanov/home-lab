---
title: AI lab
group: Infrastructure
stack: Ansible · Incus · C · Go · Slurm · Kubernetes · PyTorch · vLLM
repo: https://github.com/arkady-emelyanov/ai-lab
post: ai-lab/01-intro
---
A GPU cluster modelled on GB200 NVL72, scaled down to two compute trays and run on one Linux machine. Real Slurm or Kubernetes, PyTorch, vLLM and NCCL run against emulated GPUs, NVLink partitions, Redfish BMCs and InfiniBand, so cluster tooling can be built and tested without a rack.
