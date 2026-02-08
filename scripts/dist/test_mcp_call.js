import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readFileSync } from "fs";
const configPath = "config.json";
const config = JSON.parse(readFileSync(configPath, "utf-8"));
const transport = new StdioClientTransport({
    command: config.mcpServer.command,
    args: config.mcpServer.args,
    env: { ...process.env, ...config.mcpServer.env },
    stderr: "ignore",
});
const client = new Client({ name: "clickup-cli-test", version: "1.0.0" }, { capabilities: {} });
await client.connect(transport);
// Try calling getTaskById with include_markdown_description
try {
    const result = await client.callTool({
        name: "getTaskById",
        arguments: {
            id: "86c6wf9ya",
            include_markdown_description: true
        }
    });
    console.log("Result with include_markdown_description:");
    const content = result.content;
    const textContent = content.find((c) => c.type === "text");
    if (textContent?.text) {
        try {
            console.log(JSON.stringify(JSON.parse(textContent.text), null, 2));
        }
        catch {
            console.log(textContent.text);
        }
    }
}
catch (error) {
    console.error("Error:", error.message);
}
await client.close();
