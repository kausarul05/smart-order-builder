/**
 * MSW in Node, for the tests. The SAME handlers run here, so a test
 * exercises the real mock server rather than a second stub.
 */

import { setupServer } from 'msw/node';
import { handlers } from './handlers';

export const server = setupServer(...handlers);
