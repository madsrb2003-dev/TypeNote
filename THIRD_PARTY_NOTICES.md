# Third-party notices

## Verovio 6.3.0

TypeNote bundles the Verovio JavaScript/WebAssembly toolkit for local MusicXML engraving. The installed package identifies its author as Laurent Pugin and others and its license as **LGPL-3.0-or-later**. TypeNote uses the upstream package without modifying the library source.

- [Verovio project](https://www.verovio.org/)
- [Corresponding upstream source, version 6.3.0](https://github.com/rism-digital/verovio/tree/version-6.3.0)
- [Source archive](https://github.com/rism-digital/verovio/archive/refs/tags/version-6.3.0.tar.gz)
- [GNU Lesser General Public License version 3](public/licenses/verovio-LGPL-3.0.txt)
- [GNU General Public License version 3](public/licenses/verovio-GPL-3.0.txt), incorporated by the LGPL

The license texts are copied from that upstream version's `COPYING.LESSER` and `COPYING`. Vite copies them into the built application's `/licenses/` directory. The npm dependency is declared in `package.json` and resolved in `package-lock.json`; developers can replace the library and rebuild TypeNote with `npm run build`.

Other dependencies retain their respective licenses and notices in their installed packages. This notice does not change the terms of those dependencies.
