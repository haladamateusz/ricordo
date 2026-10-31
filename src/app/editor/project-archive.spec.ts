import { projectArchive, readProjectArchive, type ProjectPhoto } from './project-archive';
import { zipStored } from './zip-store';

describe('projectArchive', () => {
  it('keeps photo order, the open photo, captions, dates, and crop', async () => {
    const archive = await projectArchive(
      [
        photo('pier.png', 'Dawn', '2024-08-01', 0.2, 0.7, 1.2, 'portrait', 'pier-bytes'),
        photo('dog.png', 'Harbor', '2024-06-15T18:04:00', -0.2, 1.2, 9, 'landscape', 'dog-bytes'),
      ],
      1,
    );

    const imported = await readProjectArchive(archive);

    expect(imported).toEqual({
      activeIndex: 1,
      photos: [
        expect.objectContaining({
          fileName: 'pier.png',
          rightCaption: 'Dawn',
          date: '2024-08-01',
          panX: 0.2,
          panY: 0.7,
          zoom: 1.2,
          orientation: 'portrait',
        }),
        expect.objectContaining({
          fileName: 'dog.png',
          rightCaption: 'Harbor',
          date: '2024-06-15T18:04:00',
          panX: 0,
          panY: 1,
          zoom: 4,
          orientation: 'landscape',
        }),
      ],
    });
    const photos = imported?.photos ?? [];
    expect(await photos[0]?.source.text()).toBe('pier-bytes');
    expect(photos[0]?.source.type).toBe('image/png');
    expect(await photos[1]?.source.text()).toBe('dog-bytes');
  });

  it('rejects a zip that is not a project', async () => {
    const zip = zipStored([{ name: 'pier-framed.png', bytes: text('png') }]);

    await expect(readProjectArchive(zip)).resolves.toBeNull();
    await expect(readProjectArchive(new Blob(['notes']))).resolves.toBeNull();
  });

  it('rejects a manifest that points outside the archive', async () => {
    const zip = zipStored([
      {
        name: 'project.json',
        bytes: text(
          JSON.stringify({
            version: 1,
            activeIndex: 0,
            edits: [
              {
                fileName: 'secret.png',
                rightCaption: 'Hidden',
                date: '2024-01-01',
                panX: 0.5,
                panY: 0.5,
                zoom: 1,
                orientation: 'landscape',
                mediaType: 'image/png',
                image: '../secret.png',
              },
            ],
          }),
        ),
      },
      { name: '../secret.png', bytes: text('secret') },
    ]);

    await expect(readProjectArchive(zip)).resolves.toBeNull();
  });
});

function photo(
  fileName: string,
  rightCaption: string,
  date: string,
  panX: number,
  panY: number,
  zoom: number,
  orientation: ProjectPhoto['orientation'],
  bytes: string,
): ProjectPhoto {
  return {
    fileName,
    rightCaption,
    date,
    panX,
    panY,
    zoom,
    orientation,
    source: new Blob([bytes], { type: 'image/png' }),
  };
}

function text(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}
