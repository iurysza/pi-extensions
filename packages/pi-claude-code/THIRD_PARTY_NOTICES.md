# Third-party notices

## hermes-plugin-claude-subscription-directsdk

This package ports the request-scoped Claude Code transport from Nous Research's
Hermes DirectSDK plugin to TypeScript for pi. The ported parts are the admission
relay, the streamed-response capture, the prompt-cache breakpoint pin, the tool
inventory, history replay, the pinned model catalog, and the setup probes. The
inert MCP inventory server was not ported; the tool inventory travels in the
request's extra body instead.

- Source: <https://github.com/NousResearch/hermes-plugin-claude-subscription-directsdk>
- Commit: `602393b6d3ea148bc618cd23da1a13fa332e1433`
- License: MIT

```text
MIT License

Copyright (c) 2026 Nous Research and contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
