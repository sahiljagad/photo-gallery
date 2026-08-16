export interface PhotoSize {
  width: number;
  height: number;
  /** What a plain <img> loads. Always present. */
  src: string;
  /** The WebP <source>. Absent at widths where only one format was generated. */
  srcWebp?: string;
}

/** Capture details read from EXIF/XMP at build time. */
export interface Shot {
  /** Local capture time, `YYYY-MM-DDTHH:MM:SS`. Sorts lexicographically. */
  takenAt?: string;
  /** UTC offset at capture, e.g. `-07:00`. */
  offset?: string;
  camera?: string;
  lens?: string;
  focal?: number;
  focal35?: number;
  aperture?: number;
  /** Preformatted, e.g. `1/250` or `1.6s`. */
  shutter?: string;
  iso?: number;
}

export interface Photo {
  id: string;
  src: string;
  title: string | null;
  latin?: string;
  note?: string;
  shot?: Shot;
  /** XMP star rating, 0–5. Only a curation signal where the album varies. */
  rating?: number;
  order: number;
  ar: number;
  width: number;
  height: number;
  sizes: PhotoSize[];
  lqip: string;
  lightness: number;
  contrast: number;
  hue: number;
  chroma: number;
  colourfulness: number;
  busy: number;
  busyRel: number;
  massX: number;
  massY: number;
  /** Which side the frame's visual mass sits on. Not subject detection. */
  weight: 'left' | 'right' | 'centre';
}

export interface Album {
  id: string;
  title: string;
  /** Earliest capture date, `YYYY-MM-DD`. */
  date: string;
  /** Latest capture date, when the album spans more than one day. */
  dateEnd?: string;
  region?: string;
  lat?: number;
  lon?: number;
  note?: string;
  /** Prose shown at the head of the album, from `_meta.json`. */
  intro?: string;
  cover: Photo;
  photos: Photo[];
}

export type Archive = Album[];
