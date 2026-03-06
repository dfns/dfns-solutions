/**
 * Shared formatting utilities for crypto balances.
 *
 * Dfns returns wallet balances in this format:
 *   { "assets": [{ "kind": "Native", "balance": "50000000000000000", "symbol": "SepoliaETH", "decimals": 18 }] }
 *
 * This function converts that to a human-readable string like "0.050000 ETH".
 * The "Sepolia" prefix is stripped from the symbol for cleaner display.
 */

export function formatCryptoBalance(balance: unknown): string {
  if (!balance) return "—";
  if (typeof balance === "object" && balance !== null) {
    const b = balance as { assets?: Array<{ kind?: string; balance?: string; symbol?: string; decimals?: number }> };
    if (Array.isArray(b.assets)) {
      // Find the native asset (ETH/MATIC/etc.)
      const native = b.assets.find((a) => a.kind === "Native");
      if (native?.balance && native.decimals !== undefined) {
        const val = parseFloat(native.balance) / Math.pow(10, native.decimals);
        const symbol = (native.symbol || "").replace("Sepolia", "");
        return `${val.toFixed(6)} ${symbol}`;
      }
    }
    return "0";
  }
  return String(balance);
}
