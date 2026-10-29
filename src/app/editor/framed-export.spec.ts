import { framedDownloadName } from './framed-export';

describe('framedDownloadName', () => {
  it('uses the framed name and numbers later copies', () => {
    const used = new Map<string, number>();

    expect(framedDownloadName('pier.png', used)).toBe('pier-framed.png');
    expect(framedDownloadName('pier.jpeg', used)).toBe('pier-framed-2.png');
    expect(framedDownloadName('album/dog.png', used)).toBe('album-dog-framed.png');
    expect(framedDownloadName('   ', used)).toBe('photo-framed.png');
  });
});
