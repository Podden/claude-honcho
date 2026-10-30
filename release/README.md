# Release build (podden fork)

`release/honcho/` is the bundled plugin that the `honcho-podden` marketplace
installs (see `.claude-plugin/marketplace.json`). Claude Code installs plugins
from git without a build step, so the bundle is committed here. Sourcemaps are
left out to keep it at about 6.7 MB.

Install on any machine (machine-independent, no local path):

```json
"extraKnownMarketplaces": {
  "honcho-podden": { "source": { "source": "github", "repo": "Podden/claude-honcho", "ref": "podden" } }
},
"enabledPlugins": { "honcho@honcho-podden": true }
```

Rebuild after changing `plugins/honcho/src`:

```bash
cd plugins/honcho
bun install --frozen-lockfile && bun test
RELEASE_VERSION=0.3.4-podden.N bun scripts/build.ts
cd ../.. && git rm -rq release/honcho && mkdir -p release/honcho
cp -r plugins/honcho/.stage/. release/honcho/
find release/honcho -name "*.map" -delete
sed -i 's|^//# sourceMappingURL=.*$||' $(find release/honcho -name "*.js")
sed -i 's|"command": "node |"command": "bun |g' release/honcho/hooks/hooks.json
bash plugins/honcho/scripts/smoke.sh "$PWD/release/honcho"
```

`smoke.sh` and the sandboxed tests set `USERPROFILE` next to `HOME`: on
Windows `os.homedir()` reads only `USERPROFILE`, and with `HOME` alone they ran
against the real `~/.honcho/config.json` and uploaded fixture prompts to the
live workspace (session `project`). The three `isSlashCommand` cases for `/tmp`
and `/etc` still fail on Windows.

The hooks run under bun, not node: on Windows, Node 24.19 aborts the bundled
`user-prompt` hook at exit (`Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`,
exit 127; the official 0.3.2 build does not, root cause not yet found), and
Claude Code drops a hook's output on a non-zero exit. Bun runs the same bundle cleanly. This needs
bun on every machine; switch back to node once the exit crash is fixed.

Bump `metadata.version` in `.claude-plugin/marketplace.json` to the same version.
