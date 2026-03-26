import React from "react";
import { render, Box, Text } from "ink";

function App() {
  return (
    <Box flexDirection="column" borderStyle="bold" borderLeft borderColor="green">
      <Text backgroundColor="#1a1a1a" color="white">  Hello World{'\x1b[K'}</Text>
      <Text backgroundColor="#1a1a1a" color="white">  Line 2{'\x1b[K'}</Text>
    </Box>
  );
}

render(<App />);
