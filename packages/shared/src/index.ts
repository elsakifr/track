/**
 * @track/shared — domain types and validation schemas shared by every Track workspace.
 *
 * Imports use explicit `.ts` extensions and the only dependency is Zod, so this package can be
 * imported from Node, React Native, the browser and Deno (Supabase Edge Functions).
 */
export * from './position-event.ts';
export * from './ingest-response.ts';
