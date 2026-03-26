import React, { useState } from "react";
import { Box, Text } from "ink";

export const COMMANDS = [
  { cmd: "/status", desc: "Show agent status and token usage" },
  { cmd: "/config", desc: "Show current configuration" },
  { cmd: "/restart", desc: "Restart the agent daemon" },
  { cmd: "/help", desc: "List available slash commands" },
];

export function AutocompleteMenu({ input, selectedIndex }: { input: string, selectedIndex: number }) {
  if (!input.startsWith("/")) return null;

  const matches = COMMANDS.filter(c => c.cmd.startsWith(input));
  if (matches.length === 0) return null;

  return (
    <Box flexDirection="column" borderStyle="single" borderBottom={false} borderLeft={false} borderRight={false} borderColor="#444" paddingTop={0} paddingBottom={0} width="100%">
      {matches.map((match, i) => {
        const isSelected = i === selectedIndex;
        return (
          <Box key={match.cmd}>
            <Text color={isSelected ? "black" : "white"} backgroundColor={isSelected ? "cyan" : undefined} bold={isSelected}>
              {"  " + match.cmd.padEnd(12)}
            </Text>
            <Text color={isSelected ? "black" : "gray"} backgroundColor={isSelected ? "cyan" : undefined}>
              {match.desc.padEnd(100)}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
