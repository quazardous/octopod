# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- A shared Traefik for the machine, on loopback, that only routes containers octopod labelled — including when other projects run their own Traefik next to it.
- Projects declare what to expose in `octopod.yaml`; octopod generates the labels and networks, and serves each at `http://<project>.localhost` or a host under it.
- Each project on its own edge network: projects cannot reach each other.
- `octopod` CLI and a JSON API over a unix socket: register, up, down, status, logs, edge.
