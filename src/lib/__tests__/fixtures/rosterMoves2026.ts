// Live MLB Stats API transactions for three SV clients, 2025-10-16 to
// 2026-10-16 (pulled 2026-10-16). Player A and Player B each had a rehab
// stint and an IL activation; Player C was optioned and recalled all year.
import type { MLBTransaction } from '../../mlbApi'
import type { MoveTeam } from '../../rosterMoves'

export const TXNS_2026: MLBTransaction[] = [
  {
    "id": 877282,
    "player": {
      "id": 1003,
      "fullName": "Player C"
    },
    "fromTeam": {
      "id": 342,
      "name": "Albuquerque Isotopes"
    },
    "toTeam": {
      "id": 115,
      "name": "Colorado Rockies"
    },
    "typeCode": "SE",
    "typeDesc": "Selected",
    "date": "2025-11-18",
    "effectiveDate": "2025-11-18",
    "description": "Colorado Rockies selected the contract of OF Player C from Albuquerque Isotopes."
  },
  {
    "id": 884531,
    "player": {
      "id": 1002,
      "fullName": "Player B"
    },
    "toTeam": {
      "id": 940,
      "name": "United States"
    },
    "typeCode": "SC",
    "typeDesc": "Status Change",
    "date": "2026-02-05",
    "effectiveDate": "2026-02-05",
    "description": "United States activated RHP Player B."
  },
  {
    "id": 890252,
    "player": {
      "id": 1003,
      "fullName": "Player C"
    },
    "toTeam": {
      "id": 365,
      "name": "Colorado Rockies Prospects"
    },
    "typeCode": "ASG",
    "typeDesc": "Assigned",
    "date": "2026-03-05",
    "effectiveDate": "2026-03-05",
    "description": "OF Player C assigned to Colorado Rockies Prospects."
  },
  {
    "id": 891090,
    "player": {
      "id": 1003,
      "fullName": "Player C"
    },
    "fromTeam": {
      "id": 115,
      "name": "Colorado Rockies"
    },
    "toTeam": {
      "id": 342,
      "name": "Albuquerque Isotopes"
    },
    "typeCode": "OPT",
    "typeDesc": "Optioned",
    "date": "2026-03-08",
    "effectiveDate": "2026-03-08",
    "description": "Colorado Rockies optioned OF Player C to Albuquerque Isotopes."
  },
  {
    "id": 891947,
    "player": {
      "id": 1001,
      "fullName": "Player A"
    },
    "fromTeam": {
      "id": 115,
      "name": "Colorado Rockies"
    },
    "toTeam": {
      "id": 342,
      "name": "Albuquerque Isotopes"
    },
    "typeCode": "OPT",
    "typeDesc": "Optioned",
    "date": "2026-03-17",
    "effectiveDate": "2026-03-17",
    "description": "Colorado Rockies optioned RHP Player A to Albuquerque Isotopes."
  },
  {
    "id": 896880,
    "player": {
      "id": 1002,
      "fullName": "Player B"
    },
    "toTeam": {
      "id": 111,
      "name": "Boston Red Sox"
    },
    "typeCode": "SC",
    "typeDesc": "Status Change",
    "date": "2026-04-03",
    "effectiveDate": "2026-04-03",
    "description": "Boston Red Sox placed RHP Player B on the paternity list."
  },
  {
    "id": 897309,
    "player": {
      "id": 1002,
      "fullName": "Player B"
    },
    "toTeam": {
      "id": 111,
      "name": "Boston Red Sox"
    },
    "typeCode": "SC",
    "typeDesc": "Status Change",
    "date": "2026-04-06",
    "effectiveDate": "2026-04-06",
    "description": "Boston Red Sox activated RHP Player B from the paternity list."
  },
  {
    "id": 898834,
    "player": {
      "id": 1001,
      "fullName": "Player A"
    },
    "fromTeam": {
      "id": 342,
      "name": "Albuquerque Isotopes"
    },
    "toTeam": {
      "id": 115,
      "name": "Colorado Rockies"
    },
    "typeCode": "CU",
    "typeDesc": "Recalled",
    "date": "2026-04-14",
    "effectiveDate": "2026-04-14",
    "description": "Colorado Rockies recalled RHP Player A from Albuquerque Isotopes."
  },
  {
    "id": 899477,
    "player": {
      "id": 1001,
      "fullName": "Player A"
    },
    "toTeam": {
      "id": 115,
      "name": "Colorado Rockies"
    },
    "typeCode": "NUM",
    "typeDesc": "Number Change",
    "date": "2026-04-15",
    "effectiveDate": "2026-04-15",
    "description": "RHP Player A changed number to 42."
  },
  {
    "id": 899603,
    "player": {
      "id": 1002,
      "fullName": "Player B"
    },
    "toTeam": {
      "id": 111,
      "name": "Boston Red Sox"
    },
    "typeCode": "NUM",
    "typeDesc": "Number Change",
    "date": "2026-04-15",
    "effectiveDate": "2026-04-15",
    "description": "RHP Player B changed number to 42."
  },
  {
    "id": 900407,
    "player": {
      "id": 1001,
      "fullName": "Player A"
    },
    "toTeam": {
      "id": 115,
      "name": "Colorado Rockies"
    },
    "typeCode": "NUM",
    "typeDesc": "Number Change",
    "date": "2026-04-16",
    "effectiveDate": "2026-04-16",
    "description": "RHP Player A changed number to 29."
  },
  {
    "id": 900522,
    "player": {
      "id": 1002,
      "fullName": "Player B"
    },
    "toTeam": {
      "id": 111,
      "name": "Boston Red Sox"
    },
    "typeCode": "NUM",
    "typeDesc": "Number Change",
    "date": "2026-04-16",
    "effectiveDate": "2026-04-16",
    "description": "RHP Player B changed number to 22."
  },
  {
    "id": 907799,
    "player": {
      "id": 1001,
      "fullName": "Player A"
    },
    "fromTeam": {
      "id": 115,
      "name": "Colorado Rockies"
    },
    "toTeam": {
      "id": 342,
      "name": "Albuquerque Isotopes"
    },
    "typeCode": "OPT",
    "typeDesc": "Optioned",
    "date": "2026-05-12",
    "effectiveDate": "2026-05-12",
    "description": "Colorado Rockies optioned RHP Player A to Albuquerque Isotopes."
  },
  {
    "id": 908861,
    "player": {
      "id": 1001,
      "fullName": "Player A"
    },
    "fromTeam": {
      "id": 342,
      "name": "Albuquerque Isotopes"
    },
    "toTeam": {
      "id": 115,
      "name": "Colorado Rockies"
    },
    "typeCode": "CU",
    "typeDesc": "Recalled",
    "date": "2026-05-14",
    "effectiveDate": "2026-05-14",
    "description": "Colorado Rockies recalled RHP Player A from Albuquerque Isotopes."
  },
  {
    "id": 909333,
    "player": {
      "id": 1003,
      "fullName": "Player C"
    },
    "fromTeam": {
      "id": 342,
      "name": "Albuquerque Isotopes"
    },
    "toTeam": {
      "id": 115,
      "name": "Colorado Rockies"
    },
    "typeCode": "CU",
    "typeDesc": "Recalled",
    "date": "2026-05-15",
    "effectiveDate": "2026-05-15",
    "description": "Colorado Rockies recalled OF Player C from Albuquerque Isotopes."
  },
  {
    "id": 910467,
    "player": {
      "id": 1003,
      "fullName": "Player C"
    },
    "fromTeam": {
      "id": 115,
      "name": "Colorado Rockies"
    },
    "toTeam": {
      "id": 342,
      "name": "Albuquerque Isotopes"
    },
    "typeCode": "OPT",
    "typeDesc": "Optioned",
    "date": "2026-05-19",
    "effectiveDate": "2026-05-19",
    "description": "Colorado Rockies optioned RF Player C to Albuquerque Isotopes."
  },
  {
    "id": 910546,
    "player": {
      "id": 1003,
      "fullName": "Player C"
    },
    "toTeam": {
      "id": 342,
      "name": "Albuquerque Isotopes"
    },
    "typeCode": "SC",
    "typeDesc": "Status Change",
    "date": "2026-05-19",
    "effectiveDate": "2026-05-19",
    "description": "Albuquerque Isotopes activated RF Player C."
  },
  {
    "id": 911146,
    "player": {
      "id": 1003,
      "fullName": "Player C"
    },
    "fromTeam": {
      "id": 342,
      "name": "Albuquerque Isotopes"
    },
    "toTeam": {
      "id": 115,
      "name": "Colorado Rockies"
    },
    "typeCode": "CU",
    "typeDesc": "Recalled",
    "date": "2026-05-22",
    "effectiveDate": "2026-05-22",
    "description": "Colorado Rockies recalled RF Player C from Albuquerque Isotopes."
  },
  {
    "id": 912495,
    "player": {
      "id": 1002,
      "fullName": "Player B"
    },
    "toTeam": {
      "id": 111,
      "name": "Boston Red Sox"
    },
    "typeCode": "SC",
    "typeDesc": "Status Change",
    "date": "2026-05-28",
    "effectiveDate": "2026-05-25",
    "description": "Boston Red Sox placed RHP Player B on the 15-day injured list retroactive to May 25, 2026. Left knee inflammation."
  },
  {
    "id": 916216,
    "player": {
      "id": 1001,
      "fullName": "Player A"
    },
    "toTeam": {
      "id": 115,
      "name": "Colorado Rockies"
    },
    "typeCode": "SC",
    "typeDesc": "Status Change",
    "date": "2026-06-05",
    "effectiveDate": "2026-06-02",
    "description": "Colorado Rockies placed RHP Player A on the 15-day injured list retroactive to June 2, 2026. Right hip impingement."
  },
  {
    "id": 916319,
    "player": {
      "id": 1002,
      "fullName": "Player B"
    },
    "fromTeam": {
      "id": 111,
      "name": "Boston Red Sox"
    },
    "toTeam": {
      "id": 533,
      "name": "Worcester Red Sox"
    },
    "typeCode": "ASG",
    "typeDesc": "Assigned",
    "date": "2026-06-06",
    "effectiveDate": "2026-06-06",
    "description": "Boston Red Sox sent RHP Player B on a rehab assignment to Worcester Red Sox."
  },
  {
    "id": 916888,
    "player": {
      "id": 1002,
      "fullName": "Player B"
    },
    "toTeam": {
      "id": 111,
      "name": "Boston Red Sox"
    },
    "typeCode": "SC",
    "typeDesc": "Status Change",
    "date": "2026-06-09",
    "effectiveDate": "2026-06-09",
    "description": "Boston Red Sox activated RHP Player B from the 15-day injured list."
  },
  {
    "id": 921089,
    "player": {
      "id": 1003,
      "fullName": "Player C"
    },
    "fromTeam": {
      "id": 115,
      "name": "Colorado Rockies"
    },
    "toTeam": {
      "id": 342,
      "name": "Albuquerque Isotopes"
    },
    "typeCode": "OPT",
    "typeDesc": "Optioned",
    "date": "2026-06-22",
    "effectiveDate": "2026-06-22",
    "description": "Colorado Rockies optioned RF Player C to Albuquerque Isotopes."
  },
  {
    "id": 922021,
    "player": {
      "id": 1001,
      "fullName": "Player A"
    },
    "fromTeam": {
      "id": 115,
      "name": "Colorado Rockies"
    },
    "toTeam": {
      "id": 342,
      "name": "Albuquerque Isotopes"
    },
    "typeCode": "ASG",
    "typeDesc": "Assigned",
    "date": "2026-06-24",
    "effectiveDate": "2026-06-24",
    "description": "Colorado Rockies sent RHP Player A on a rehab assignment to Albuquerque Isotopes."
  },
  {
    "id": 923800,
    "player": {
      "id": 1001,
      "fullName": "Player A"
    },
    "toTeam": {
      "id": 115,
      "name": "Colorado Rockies"
    },
    "typeCode": "SC",
    "typeDesc": "Status Change",
    "date": "2026-06-30",
    "effectiveDate": "2026-06-30",
    "description": "Colorado Rockies activated RHP Player A from the 15-day injured list."
  },
  {
    "id": 933791,
    "player": {
      "id": 1003,
      "fullName": "Player C"
    },
    "toTeam": {
      "id": 342,
      "name": "Albuquerque Isotopes"
    },
    "typeCode": "SC",
    "typeDesc": "Status Change",
    "date": "2026-07-31",
    "effectiveDate": "2026-07-31",
    "description": "Albuquerque Isotopes placed RF Player C on the 7-day injured list."
  },
  {
    "id": 937393,
    "player": {
      "id": 1002,
      "fullName": "Player B"
    },
    "toTeam": {
      "id": 111,
      "name": "Boston Red Sox"
    },
    "typeCode": "SC",
    "typeDesc": "Status Change",
    "date": "2026-08-13",
    "effectiveDate": "2026-08-10",
    "description": "Boston Red Sox placed RHP Player B on the 15-day injured list retroactive to August 10, 2026. Right elbow inflammation."
  },
  {
    "id": 938331,
    "player": {
      "id": 1003,
      "fullName": "Player C"
    },
    "toTeam": {
      "id": 342,
      "name": "Albuquerque Isotopes"
    },
    "typeCode": "SC",
    "typeDesc": "Status Change",
    "date": "2026-08-18",
    "effectiveDate": "2026-08-18",
    "description": "Albuquerque Isotopes activated RF Player C from the 7-day injured list."
  },
  {
    "id": 939936,
    "player": {
      "id": 1002,
      "fullName": "Player B"
    },
    "toTeam": {
      "id": 111,
      "name": "Boston Red Sox"
    },
    "typeCode": "SC",
    "typeDesc": "Status Change",
    "date": "2026-08-29",
    "effectiveDate": "2026-08-29",
    "description": "Boston Red Sox activated RHP Player B from the 15-day injured list."
  },
  {
    "id": 942723,
    "player": {
      "id": 1002,
      "fullName": "Player B"
    },
    "toTeam": {
      "id": 111,
      "name": "Boston Red Sox"
    },
    "typeCode": "NUM",
    "typeDesc": "Number Change",
    "date": "2026-09-15",
    "effectiveDate": "2026-09-15",
    "description": "RHP Player B changed number to 21."
  },
  {
    "id": 942850,
    "player": {
      "id": 1002,
      "fullName": "Player B"
    },
    "toTeam": {
      "id": 111,
      "name": "Boston Red Sox"
    },
    "typeCode": "NUM",
    "typeDesc": "Number Change",
    "date": "2026-09-16",
    "effectiveDate": "2026-09-16",
    "description": "RHP Player B changed number to 22."
  },
  {
    "id": 944600,
    "player": {
      "id": 1003,
      "fullName": "Player C"
    },
    "fromTeam": {
      "id": 342,
      "name": "Albuquerque Isotopes"
    },
    "toTeam": {
      "id": 115,
      "name": "Colorado Rockies"
    },
    "typeCode": "CU",
    "typeDesc": "Recalled",
    "date": "2026-09-28",
    "effectiveDate": "2026-09-28",
    "description": "Colorado Rockies recalled RF Player C from Albuquerque Isotopes."
  }
]

export const AFFILIATES: MoveTeam[] = [
  {
    "teamId": 546,
    "teamName": "Portland Sea Dogs",
    "sportId": 12,
    "parentOrgId": 111
  },
  {
    "teamId": 533,
    "teamName": "Worcester Red Sox",
    "sportId": 11,
    "parentOrgId": 111
  },
  {
    "teamId": 111,
    "teamName": "Boston Red Sox",
    "sportId": 1,
    "parentOrgId": 111
  },
  {
    "teamId": 342,
    "teamName": "Albuquerque Isotopes",
    "sportId": 11,
    "parentOrgId": 115
  },
  {
    "teamId": 538,
    "teamName": "Hartford Yard Goats",
    "sportId": 12,
    "parentOrgId": 115
  },
  {
    "teamId": 365,
    "teamName": "Colorado Rockies Prospects",
    "sportId": 21,
    "parentOrgId": 115
  },
  {
    "teamId": 115,
    "teamName": "Colorado Rockies",
    "sportId": 1,
    "parentOrgId": 115
  }
]
