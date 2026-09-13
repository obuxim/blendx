/**
 * Every action of the addition API, by table and name. The types come from the API's AppType
 * (a type-only import: no server code reaches the page) and the routes from its generated map.
 */
import { createBlendxClient } from '@blendx/react';
import { hc } from 'blendx/client';
import type { AppType } from '../../server.ts';
import { tables } from '../../src/generated/client.gen.ts';

export const api = createBlendxClient(hc<AppType>('/api'), tables);
