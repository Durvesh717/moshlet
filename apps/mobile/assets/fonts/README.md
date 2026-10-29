# Fonts

- **Geist**: the app's own text.
- **JetBrains Mono Nerd Font Mono**: the default terminal font, and the icons (prompt symbols and
  the like) for every terminal font.
- **Adwaita Mono**: symbols JetBrains Mono lacks (⏵ ⏸ ✻ ℹ ...), and a terminal font of its own.
- **Fira Code, Caskaydia Cove (Cascadia Code), Geist Mono, Hack and Ubuntu Mono**: the other
  terminal fonts, from [Nerd Fonts](https://github.com/ryanoasis/nerd-fonts) v3.5.1 (the
  `NerdFontMono` builds), with the icon ranges taken out to keep them small, since JetBrains Mono
  draws those:

  ```sh
  pyftsubset <font> --unicodes='U+0000-DFFF,U+F900-FFFF,U+10000-EFFFF' --layout-features='*' \
    --glyph-names --symbol-cmap --legacy-cmap --notdef-glyph --notdef-outline \
    --recommended-glyphs --name-IDs='*' --name-languages='*' --name-legacy --drop-tables=
  ```

Every font's license is in `licenses/` (`Geist.txt` covers Geist and Geist Mono).
