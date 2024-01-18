import * as React from "rehackt";

import type { DeepPartial } from "../../utilities/index.js";
import { mergeDeepArray } from "../../utilities/index.js";
import type {
  Cache,
  Reference,
  StoreObject,
  MissingTree,
} from "../../cache/index.js";

import { useApolloClient } from "./useApolloClient.js";
import { useSyncExternalStore } from "./useSyncExternalStore.js";
import type { OperationVariables } from "../../core/index.js";
import type { NoInfer } from "../types/types.js";
import { useDeepMemo, useLazyRef } from "./internal/index.js";

export interface UseFragmentOptions<TData, TVars>
  extends Omit<
      Cache.DiffOptions<NoInfer<TData>, NoInfer<TVars>>,
      "id" | "query" | "optimistic" | "previousResult" | "returnPartialData"
    >,
    Omit<
      Cache.ReadFragmentOptions<TData, TVars>,
      "id" | "variables" | "returnPartialData"
    > {
  from: StoreObject | Reference | string;
  // Override this field to make it optional (default: true).
  optimistic?: boolean;
}

export type UseFragmentResult<TData> =
  | {
      data: TData;
      complete: true;
      missing?: never;
    }
  | {
      data: DeepPartial<TData>;
      complete: false;
      missing?: MissingTree;
    };

export function useFragment<TData = any, TVars = OperationVariables>(
  options: UseFragmentOptions<TData, TVars>
): UseFragmentResult<TData> {
  const { cache } = useApolloClient();

  const diffOptions = useDeepMemo<Cache.DiffOptions<TData, TVars>>(() => {
    const {
      fragment,
      fragmentName,
      from,
      optimistic = true,
      ...rest
    } = options;

    return {
      ...rest,
      returnPartialData: true,
      id: typeof from === "string" ? from : cache.identify(from),
      query: cache["getFragmentDoc"](fragment, fragmentName),
      optimistic,
    };
  }, [options]);

  // TODO: use regular useRef here and set the value inside of useMemo
  const resultRef = useLazyRef<UseFragmentResult<TData>>(() =>
    diffToResult(cache.diff<TData>(diffOptions))
  );
  // explain the timing issue: since next is async, we need to make sure that we
  // get the correct diff on next render given new diffOptions
  React.useMemo(() => {
    resultRef.current = diffToResult(cache.diff<TData>(diffOptions));
  }, [diffOptions, cache]);

  // Used for both getSnapshot and getServerSnapshot
  const getSnapshot = React.useCallback(() => resultRef.current, []);

  return useSyncExternalStore(
    React.useCallback(
      (forceUpdate) => {
        let lastTimeout = 0;
        const subscription = cache.watchFragment(options).subscribe({
          next: (result) => {
            resultRef.current = result;
            // TODO: add comment back here
            clearTimeout(lastTimeout);
            lastTimeout = setTimeout(forceUpdate) as any;
          },
        });
        return () => {
          subscription.unsubscribe();
          clearTimeout(lastTimeout);
        };
      },
      [cache, diffOptions]
    ),
    getSnapshot,
    getSnapshot
  );
}

function diffToResult<TData>(
  diff: Cache.DiffResult<TData>
): UseFragmentResult<TData> {
  const result = {
    data: diff.result!,
    complete: !!diff.complete,
  } as UseFragmentResult<TData>;

  if (diff.missing) {
    result.missing = mergeDeepArray(diff.missing.map((error) => error.missing));
  }

  return result;
}
