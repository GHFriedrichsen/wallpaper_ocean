// Geometry of the glass cube (world units). The cube is centered at the origin.
export const CUBE = {
  size: 2,          // width/depth of the water volume
  bottom: -1,       // bottom of the glass
  top: 1,           // top of the glass
  sandTop: -0.9,    // top of the sand layer (deep down, mostly lost in the blue)
  waterLevel: 0.55, // resting height of the water surface
};

export const QUALITY = {
  low:    { pixelRatio: 0.6,  waterSegments: 64,  simSize: 128, rainCount: 1500,  snowCount: 800,  cloudOctaves: 3, causticIter: 3 },
  medium: { pixelRatio: 0.8,  waterSegments: 128, simSize: 192, rainCount: 3500,  snowCount: 1500, cloudOctaves: 4, causticIter: 4 },
  high:   { pixelRatio: 1.0,  waterSegments: 192, simSize: 256, rainCount: 6000,  snowCount: 2500, cloudOctaves: 5, causticIter: 5 },
  ultra:  { pixelRatio: 1.5,  waterSegments: 256, simSize: 384, rainCount: 10000, snowCount: 4000, cloudOctaves: 6, causticIter: 5 },
};

// Default values for every user property. They mirror wallpaper/project.json.
export const DEFAULTS = {
  uilanguage: 'auto',
  city: 'São Paulo',
  units: 'metric',
  quality: 'high',
  fpslimit: 60,
  weatheroverride: 'auto',
  timeoverride: 'auto',
  showhud: true,
  hudposition: 'topleft',
  fishcount: 16,
  whalecount: 1,
  sharkcount: 2,
  mouseripples: true,
  parallax: 60,
  cubescale: 100,
  refreshminutes: 15,
};
