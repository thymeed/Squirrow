"""Generates the PWA icons in public/ from the robot sprite (no dependencies).
Run from the repo root: python scripts/make-icons.py"""
import struct
import zlib

BOT = ["....oo....", "....ee....", "..oooooo..", ".oBBBBBBo.", ".oBkBBkBo.", ".oBBBBBBo.", ".oBmmmmBo.", "..oooooo..", ".oBo..oBo.", "..oo..oo.."]
PAL = {'o': (0x1f, 0x25, 0x40), 'B': (0x6e, 0xa8, 0xff), 'k': (0x1f, 0x25, 0x40), 'm': (0x1f, 0x25, 0x40), 'e': (0xff, 0xd2, 0x3f)}
BG = (0x4f, 0x46, 0xe5)


def png(size):
    scale = size * 5 // 8 // 10
    off = (size - scale * 10) // 2
    rows = []
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            sx, sy = (x - off) // scale, (y - off) // scale
            c = BOT[sy][sx] if 0 <= sx < 10 and 0 <= sy < 10 and x >= off and y >= off else '.'
            row += bytes(PAL.get(c, BG))
        rows.append(bytes(row))

    def chunk(tag, data):
        body = tag + data
        return struct.pack('>I', len(data)) + body + struct.pack('>I', zlib.crc32(body))

    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(b''.join(rows), 9)) + chunk(b'IEND', b'')


for name, size in [('icon-192.png', 192), ('icon-512.png', 512), ('apple-touch-icon.png', 180)]:
    with open(f'public/{name}', 'wb') as f:
        f.write(png(size))
