import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readFileSync } from "fs";
const configPath = "config.json";
const config = JSON.parse(readFileSync(configPath, "utf-8"));
const transport = new StdioClientTransport({
    command: config.mcpServer.command,
    args: config.mcpServer.args,
    env: { ...process.env, ...config.mcpServer.env },
    stderr: "pipe",
});
const client = new Client({ name: "clickup-cli-test", version: "1.0.0" }, { capabilities: {} });
await client.connect(transport);
// Get the raw response
try {
    const result = await client.callTool({
        name: "getTaskById",
        arguments: { id: "86c6wf9ya" }
    });
    console.log("Raw result object:");
    console.log(JSON.stringify(result, null, 2));
}
catch (error) {
    console.error("Error:", error.message);
}
await client.close();
