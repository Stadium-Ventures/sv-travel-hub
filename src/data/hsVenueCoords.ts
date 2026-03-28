// Hardcoded HS venue coordinates for schools where Nominatim geocoding fails
// These are the school's baseball field locations
export const HS_VENUE_COORDS: Record<string, { name: string; lat: number; lng: number }> = {
  'Stony Brook|NY': { name: 'Stony Brook HS Field', lat: 40.9126, lng: -73.1284 },
  'Etowah|GA': { name: 'Etowah Eagles Field', lat: 34.0985, lng: -84.5197 },
  'Hernando|MS': { name: 'Hernando HS Field', lat: 34.8239, lng: -89.9937 },
  'Christ Church|SC': { name: 'Christ Church Field', lat: 34.8543, lng: -82.3363 },
  'Timber Creek|FL': { name: 'Timber Creek HS Field', lat: 28.4577, lng: -81.3841 },
  'Suwannee|FL': { name: 'Suwannee HS Field', lat: 30.2949, lng: -82.9857 },
  'B.R. Catholic|LA': { name: 'Catholic HS Field', lat: 30.4431, lng: -91.1565 },
  'Trinity|KY': { name: 'Trinity HS Field', lat: 38.2530, lng: -85.7645 },
  'Briarcrest|TN': { name: 'Briarcrest Field', lat: 35.0106, lng: -89.8482 },
  'Cartersville|GA': { name: 'Cartersville HS Field', lat: 34.1652, lng: -84.7999 },
  // Schools that already geocode successfully (backup in case geocoding fails again):
  'James Island|SC': { name: 'James Island HS Field', lat: 32.7320, lng: -79.9348 },
  'Sarasota HS|FL': { name: 'Sarasota HS Field', lat: 27.3247, lng: -82.5263 },
  "St. Joseph's Prep|PA": { name: "St. Joseph's Prep Field", lat: 39.9527, lng: -75.1635 },
  'Iona Prep|NY': { name: 'Iona Prep Field', lat: 40.9115, lng: -73.7826 },
  'Cardinal Gibbons|NC': { name: 'Cardinal Gibbons Field', lat: 35.8022, lng: -78.7290 },
  'South Walton|FL': { name: 'South Walton HS Field', lat: 30.3466, lng: -86.2308 },
  'The Hun School|NJ': { name: 'Hun School Field', lat: 40.3497, lng: -74.6597 },
  'Muskego|WI': { name: 'Muskego HS Field', lat: 42.8851, lng: -88.1488 },
  'IMG|FL': { name: 'IMG Academy Field', lat: 27.4406, lng: -82.6088 },
  'Spotswood|VA': { name: 'Spotswood HS Field', lat: 38.3857, lng: -78.8025 },
  'N. Broward Prep|FL': { name: 'N. Broward Prep Field', lat: 26.2517, lng: -80.1789 },
  'Mill Creek|GA': { name: 'Mill Creek HS Field', lat: 34.0788, lng: -83.8786 },
}
