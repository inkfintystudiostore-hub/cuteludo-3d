# Pawn models

Drop binary glTF (`.glb`) models here and the game picks them up automatically:

## Per-character (slot 0..3) overrides — recommended for unique personalities
- `pawn_pink_0.glb` .. `pawn_pink_3.glb`
- `pawn_cyan_0.glb` .. `pawn_cyan_3.glb`
- `pawn_yellow_0.glb` .. `pawn_yellow_3.glb`
- `pawn_mint_0.glb` .. `pawn_mint_3.glb`

## Per-team fallback
- `pawn_pink.glb`
- `pawn_cyan.glb`
- `pawn_yellow.glb`
- `pawn_mint.glb`

Any slot without a custom `.glb` uses the built-in cute 3D animal characters (`Sunny`, `Professor`, `Sleepy`, `Rascal`).

Models are normalized to `1.55` units tall, stood on the tile (`y = 0`), and re-shaded with the anime toon material (base colour and high-res `map` textures are kept with `anisotropy = 8`). The face should look along `+Z`.

Optional animation clips, matched by exact name: `Idle`, `Hop`, `Dance`, `SipCoffee`.
