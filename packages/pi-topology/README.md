# pi-topology

`/topology` opens a browser editor for the saved subagent workflows of the current project.

- Lists `.pi/workflows`, `.agents/workflows` and `~/.pi/agent/workflows`, marking shadowed copies.
- Draws each workflow as a topology: agents, phases, `parallel` fan-outs, loops, `if` blocks, data hand-offs.
- Edits prompts, labels, agent types and schemas. Adds, moves and deletes steps. Creates new workflows.
- The `.js` file stays the source of truth. The editor parses it with acorn and splices text, so code it does not understand shows as a dashed "code" box and is left untouched.

`/topology stop` shuts the server down. The server binds to 127.0.0.1 on a random port and needs the token in the opened URL.

Limits: prompts built from concatenation show as expressions. Edit those in the Source tab. `pipeline()` is not drawn yet.
