import type { AIUsage } from "@/lib/types";
import { Badge } from "./Badge";

/** AI usage for a finished run: requests, cached checks and reported tokens. Never estimates missing tokens. */
export function UsageLine({ usage, detailed }: { usage?: AIUsage | null; detailed?: boolean }) {
  if (!usage || (usage.requests === 0 && usage.cache_hits === 0)) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <span>
        {usage.requests.toLocaleString()} AI checks &middot; {usage.cache_hits.toLocaleString()} cached &middot;{" "}
        {detailed
          ? `${usage.prompt_tokens.toLocaleString()} in · ${usage.completion_tokens.toLocaleString()} out tokens`
          : `${usage.total_tokens.toLocaleString()} tokens`}
      </span>
      {usage.unreported_requests > 0 ? (
        <Badge tone="warning" title={`Usage was not reported for ${usage.unreported_requests} requests`}>totals may be incomplete</Badge>
      ) : null}
    </span>
  );
}
