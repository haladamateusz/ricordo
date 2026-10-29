import { heicWithExifDate, jpegWithExifDate } from './photo-exif-fixture';
import { readCreatedDate } from './photo-created-date';

const capturedAt = '2024:06:15 10:30:00';
const createdAt = '2023:01:02 08:00:00';

describe('readCreatedDate', () => {
  it('reads the capture date and time from a JPEG', async () => {
    const file = jpegWithExifDate('pier.jpg', [{ tag: 0x9003, value: capturedAt }]);

    await expect(readCreatedDate(file)).resolves.toBe('2024-06-15T10:30:00');
  });

  it('reads the capture date and time from a HEIC file', async () => {
    const file = heicWithExifDate('pier.heic', [{ tag: 0x9003, value: capturedAt }]);

    await expect(readCreatedDate(file)).resolves.toBe('2024-06-15T10:30:00');
  });

  it('reads a HEIC created date when the file type is missing', async () => {
    const file = heicWithExifDate('PIER.HEIC', [{ tag: 0x9004, value: createdAt }], '');

    await expect(readCreatedDate(file)).resolves.toBe('2023-01-02T08:00:00');
  });

  it('prefers the capture date over the digitized created date', async () => {
    const file = jpegWithExifDate('pier.jpg', [
      { tag: 0x9003, value: capturedAt },
      { tag: 0x9004, value: createdAt },
    ]);

    await expect(readCreatedDate(file)).resolves.toBe('2024-06-15T10:30:00');
  });

  it('uses the digitized created date when the photo has no capture date', async () => {
    const file = jpegWithExifDate('scan.jpg', [{ tag: 0x9004, value: createdAt }]);

    await expect(readCreatedDate(file)).resolves.toBe('2023-01-02T08:00:00');
  });

  it('reads a capture date that has no clock time', async () => {
    const file = jpegWithExifDate('pier.jpg', [{ tag: 0x9003, value: '2024:06:15' }]);

    await expect(readCreatedDate(file)).resolves.toBe('2024-06-15');
  });

  it('keeps the date when the clock time is impossible', async () => {
    const file = jpegWithExifDate('pier.jpg', [{ tag: 0x9003, value: '2024:06:15 25:00:00' }]);

    await expect(readCreatedDate(file)).resolves.toBe('2024-06-15');
  });

  it('ignores a calendar date that does not exist', async () => {
    const file = jpegWithExifDate('pier.jpg', [{ tag: 0x9003, value: '2023:02:31 10:30:00' }]);

    await expect(readCreatedDate(file)).resolves.toBeNull();
  });

  it('leaves PNG files alone', async () => {
    const file = new File(['png'], 'dog.png', { type: 'image/png' });

    await expect(readCreatedDate(file)).resolves.toBeNull();
  });
});
