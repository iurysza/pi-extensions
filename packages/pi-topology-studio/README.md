# pi-topology-studio

`/studio` opens [Topology studio](../../../topology-studio) for the project Pi is running in.

- Starts the studio server on a random local port and opens your browser.
- Exposes it on the tailnet through `local-web-gateway expose`, when available. The tailnet link is shown in the notification.
- Running `/studio` again reopens the same server. `/studio stop` closes it. Closing Pi closes it too.

Set `TOPOLOGY_STUDIO_DIR` if the studio repo is not at `~/dev/personal/tools/topology-studio`.
