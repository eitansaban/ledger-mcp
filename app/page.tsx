export default function Home() {
  return (
    <main style={{ fontFamily: "system-ui", padding: "2rem", maxWidth: 640 }}>
      <h1>ledger-mcp</h1>
      <p>
        Remote MCP server. Connect it as a custom connector in claude.ai using
        the <code>/api/mcp</code> endpoint with your access key.
      </p>
      <p>Tools: whats_being_built · agent_health · weekly_spend</p>
    </main>
  );
}
