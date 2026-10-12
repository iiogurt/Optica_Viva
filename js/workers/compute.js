// Module worker: runs the pure tasks from js/lib/tasks.js off the main thread.
import { TASKS } from '../lib/tasks.js';

self.onmessage = (e) => {
  const { id, task, args } = e.data;
  try {
    const { result, transfer } = TASKS[task](args);
    self.postMessage({ id, result }, transfer);
  } catch (err) {
    self.postMessage({ id, error: err && err.message ? err.message : String(err) });
  }
};
