# Changelog

All notable changes to the L2M Agent extension (`l2m.vscode-l2m-agent`).

## 0.1.1

### Fixed
- **A failed model call is reported as an error, not as an answer.** When the workflow's model call fails (for example the model server answers 404 "model not found", refuses the connection or times out), the chat now shows one short message, such as `The model call failed: ollama answered 404: model "qwen2.5:7b" not found, try pulling it first. Check the chat model settings of workflow "wf-vscode-l2m-coding-agent" in L2M.`, instead of the raw run JSON. Other failed runs name the node that failed, and a run that finishes without an answer says so. The full run L2M returned is written to the **L2M Agent** output channel (**View → Output**). Progress lines say "agent_1 failed." for a failed node. Older L2M servers, which reported such a run as a success, get the same message.

## 0.1.0

- First release on the VS Code Marketplace and Open VSX.
