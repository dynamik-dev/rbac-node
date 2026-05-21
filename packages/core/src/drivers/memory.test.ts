import { runConformanceSuite } from '../testing/conformance.js';
import { InMemoryDriver } from './memory.js';

runConformanceSuite({
  name: 'InMemoryDriver',
  createDriver: () => ({ driver: new InMemoryDriver() }),
});
