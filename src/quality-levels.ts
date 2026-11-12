/**
 * The shadow map size at each adaptive quality level (Stage.quality), in one
 * place for the stage and the diagnostics that report it.
 *   0: 1024 px   1-2: 512 px   3: 256 px
 */
export function shadowMapSize(quality: number): number {
  return quality >= 3 ? 256 : quality >= 1 ? 512 : 1024;
}
