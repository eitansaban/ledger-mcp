export const metadata = {
  title: "ledger-mcp",
  description: "Remote MCP server for the agent-state ledger",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
