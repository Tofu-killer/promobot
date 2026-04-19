import { useEffect, useState } from 'react';
import { getErrorMessage } from '../lib/api';

export type AsyncStatus = 'idle' | 'loading' | 'success' | 'error';

export interface AsyncState<T> {
  status: AsyncStatus;
  data?: T;
  error?: string | null;
}

export function useAsyncQuery<T>(query: () => Promise<T>, deps: readonly unknown[] = []) {
  const [requestVersion, setRequestVersion] = useState(0);
  const [state, setState] = useState<AsyncState<T>>({
    status: 'idle',
    error: null,
  });

  useEffect(() => {
    let cancelled = false;

    setState((currentState) => ({
      status: 'loading',
      data: currentState.data,
      error: null,
    }));

    void query()
      .then((data) => {
        if (cancelled) {
          return;
        }

        setState({
          status: 'success',
          data,
          error: null,
        });
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        setState((currentState) => ({
          status: 'error',
          data: currentState.data,
          error: getErrorMessage(error),
        }));
      });

    return () => {
      cancelled = true;
    };
  }, [requestVersion, ...deps]);

  return {
    state,
    reload: () => setRequestVersion((currentVersion) => currentVersion + 1),
  };
}

export function useAsyncAction<TInput, TOutput>(action: (input: TInput) => Promise<TOutput>) {
  const [state, setState] = useState<AsyncState<TOutput>>({
    status: 'idle',
    error: null,
  });

  async function run(input: TInput) {
    setState((currentState) => ({
      status: 'loading',
      data: currentState.data,
      error: null,
    }));

    try {
      const data = await action(input);

      setState({
        status: 'success',
        data,
        error: null,
      });

      return data;
    } catch (error) {
      setState((currentState) => ({
        status: 'error',
        data: currentState.data,
        error: getErrorMessage(error),
      }));

      throw error;
    }
  }

  return {
    state,
    run,
  };
}
