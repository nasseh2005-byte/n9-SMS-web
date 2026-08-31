function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function manualMessageSignatures(messages) {
  return (Array.isArray(messages) ? messages : [])
    .filter((message) => message?.sourceKind === "manual")
    .map((message) => JSON.stringify(stableValue(message)))
    .sort();
}

export function hasManualMessageChanges(previousMessages, nextMessages) {
  const previous = manualMessageSignatures(previousMessages);
  const next = manualMessageSignatures(nextMessages);
  return previous.length !== next.length || previous.some((signature, index) => signature !== next[index]);
}
