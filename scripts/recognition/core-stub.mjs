export * from 'three';
export const createComponent = (name, schema) => ({ name, schema });
export const Types = new Proxy({}, { get: (_t, k) => String(k) });
