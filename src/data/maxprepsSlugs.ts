// Mapping from "OrgName|State" → MaxPreps URL slug
// URL pattern: https://www.maxpreps.com/{slug}/baseball/schedule/
//
// The key format uses "OrgName|State" because the same school name
// can exist in different states (e.g., "Hebron" in TX vs OH).
//
// How to find a slug:
//   1. Go to maxpreps.com and search for the school
//   2. Navigate to their Baseball → Schedule page
//   3. The URL will be: https://www.maxpreps.com/{state}/{city}/{school-slug}/baseball/schedule/
//   4. The slug is the "{state}/{city}/{school-slug}" portion
//
// Example:
//   URL: https://www.maxpreps.com/tx/carrollton/hebron-hawks/baseball/schedule/
//   Key: "Hebron|TX"
//   Slug: "tx/carrollton/hebron-hawks"
export const MAXPREPS_SLUGS: Record<string, string> = {
  'Stony Brook|NY': 'ny/stony-brook/stony-brook-bears',
  'Etowah|GA': 'ga/woodstock/etowah-eagles',
  'Hernando|MS': 'ms/hernando/hernando-tigers',
  'Christ Church|SC': 'sc/greenville/christ-church-episcopal-cavaliers',
  'Timber Creek|FL': 'fl/orlando/timber-creek-wolves',
  'Suwannee|FL': 'fl/live-oak/suwannee-bulldogs',
  'B.R. Catholic|LA': 'la/baton-rouge/catholic-br-bears',
  'Trinity|KY': 'ky/louisville/trinity-shamrocks',
  'James Island|SC': 'sc/charleston/james-island-trojans',
  'Sarasota HS|FL': 'fl/sarasota/sarasota-sailors',
  "St. Joseph's Prep|PA": 'pa/philadelphia/st-josephs-prep-hawks',
  'Iona Prep|NY': 'ny/new-rochelle/iona-prep-gaels',
  'Cardinal Gibbons|NC': 'nc/raleigh/cardinal-gibbons-crusaders',
  'South Walton|FL': 'fl/santa-rosa-beach/south-walton-seahawks',
  'The Hun School|NJ': 'nj/princeton/hun-raiders',
  'Muskego|WI': 'wi/muskego/muskego-warriors',
  'IMG|FL': 'fl/bradenton/img-academy-ascenders',
  'Briarcrest|TN': 'tn/eads/briarcrest-christian-saints',
  'Spotswood|VA': 'va/penn-laird/spotswood-trailblazers',
  'N. Broward Prep|FL': 'fl/coconut-creek/north-broward-prep-eagles',
  'Cartersville|GA': 'ga/cartersville/cartersville-hurricanes',
  'Mill Creek|GA': 'ga/hoschton/mill-creek-hawks',
  // Broward High School|FL — no MaxPreps page found
}
