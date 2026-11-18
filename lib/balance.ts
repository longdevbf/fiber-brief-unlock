import type { FiberBrowserNode } from '@fiber-pay/sdk/browser';

/** On-chain CKB (in shannons) held by the node's funding address, read from a public Testnet RPC. */
export async function readOnchainShannons(node: FiberBrowserNode) {
  const { default_funding_lock_script: script } = await node.nodeInfo();
  const response = await fetch('https://testnet.ckbapp.dev/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(10_000),
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'get_cells_capacity', params: [{ script, script_type: 'lock' }] }),
  });
  const { result } = await response.json();
  if (!response.ok || typeof result?.capacity !== 'string') throw new Error('Could not read the Testnet balance.');
  return BigInt(result.capacity);
}
