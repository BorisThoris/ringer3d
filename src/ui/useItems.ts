import { useSyncExternalStore } from 'react';
import { services } from '../services';
import type { ItemsService } from '../services/types';

const EMPTY: ReturnType<ItemsService['held']> = { marbles: [], bags: [], error: null };
const none = () => () => {};

/** Marbles and bags the platform holds (the Steam inventory); empty where it holds none. */
export function useItems(): ReturnType<ItemsService['held']> {
  const it = services.items;
  return useSyncExternalStore(it ? it.subscribe : none, it ? it.held : () => EMPTY);
}
