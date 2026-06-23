import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase'

const updates: { name: string; category?: string; distributor: string; item_number?: string; distributor_item_name?: string }[] = [
  // Containers & Cups
  { name: 'Kids Ice Cups', distributor: 'bunzl', item_number: 'J6990050', distributor_item_name: '6 OZ KIDS CUP (1000)' },
  { name: 'Small Ice Cups', distributor: 'bunzl', item_number: 'J6990075', distributor_item_name: 'YESPAC SMALL PAPER CUP' },
  { name: 'Large Ice Cups', distributor: 'bunzl', item_number: 'J6990048', distributor_item_name: '16 OZ LARGE CUPS' },
  { name: 'Quarts', distributor: 'bunzl', item_number: '13400533', distributor_item_name: 'PAPER 32 OZ QUART (500)' },
  { name: 'Ice Flights', distributor: 'discontinued' },
  { name: 'Gallon Containers', distributor: 'bunzl', item_number: '22661707', distributor_item_name: 'ONE GALLON BUCKET (100)' },
  { name: '2.5 Gallon Containers', distributor: 'bunzl', item_number: 'H3470024', distributor_item_name: '2.5 GAL LOGO BUCKET & LID' },
  { name: '1st Day Spring Cups', distributor: 'seasonal' },
  { name: 'Small Custard Cups', distributor: 'bunzl', item_number: 'M2100001', distributor_item_name: 'NEW PARFAIT CUP 7OZ' },
  { name: 'Large Custard Cups', distributor: 'bunzl', item_number: 'M2100002', distributor_item_name: 'PARFAIT CUP PET 16OZ' },
  { name: 'Large Sundae Bowls', distributor: 'bunzl', item_number: '12500693', distributor_item_name: '16 OZ CLEAR SUNDAE BOWL' },
  { name: 'Pints', distributor: 'bunzl', item_number: '18200100', distributor_item_name: 'DART CUSTARD PINT (500)' },
  { name: 'Small Milkshake Cups', distributor: 'bunzl', item_number: 'E7680176', distributor_item_name: '12 OZ CLEAR CUP' },
  { name: 'Large Milkshake Cups', distributor: 'bunzl', item_number: 'E7680177', distributor_item_name: '20 OZ CLEAR CUP' },
  { name: 'Individual Hinged Cookie Containers', distributor: 'bunzl', item_number: '39355508', distributor_item_name: 'INDIVIDUAL HINGED COOKIE CONTAINER' },
  { name: '6-Pack Cookie Containers', distributor: 'bunzl', item_number: '39355508', distributor_item_name: '6 PK COOKIE PACKAGE' },
  { name: 'Food Boats (Small)', distributor: 'other' },
  // Lids
  { name: 'Kids Ice Cup Lids', distributor: 'bunzl', item_number: '12500111', distributor_item_name: '6 OZ KIDS LID' },
  { name: 'Small Ice Cup Lids', distributor: 'bunzl', item_number: 'J6990097', distributor_item_name: 'YESPAC SMALL PAPER LID' },
  { name: 'Large Ice Cup Lids', distributor: 'bunzl', item_number: '18208869', distributor_item_name: 'LARGE FLAT ICE LID 16oz' },
  { name: 'Quart Ice Cup Lids', distributor: 'bunzl', item_number: '14701434', distributor_item_name: "RITA'S QUART LID" },
  { name: 'Ice Flight Lids', distributor: 'discontinued' },
  { name: 'Gallon Lids', distributor: 'bunzl', item_number: '22662239', distributor_item_name: 'ONE GALLON LID' },
  { name: 'Small/Large Custard Cup Lids', distributor: 'bunzl', item_number: 'M2100000', distributor_item_name: 'NEW PARFAIT LID 7OZ/16OZ' },
  { name: 'Large Sundae Bowl Lids', distributor: 'bunzl', item_number: '12500716', distributor_item_name: '16 OZ SUNDAE DOME LID' },
  { name: 'Pint Lids', distributor: 'bunzl', item_number: '18200105', distributor_item_name: 'DART CUSTARD PINT LIDS (500)' },
  { name: 'Milkshake Cup Lids', distributor: 'bunzl', item_number: 'E7680124', distributor_item_name: '12/20 LID WIDE HOLE DOME' },
  { name: 'Topping Cup Lids', distributor: 'bunzl', item_number: '12501397', distributor_item_name: '2 OZ SOUFFLE LID (2500)' },
  // Spoons & Straws
  { name: 'Regular Spoons', distributor: 'bunzl', item_number: '75002494', distributor_item_name: 'WATER ICE SPOONS (1000)' },
  { name: 'Long Spoons', distributor: 'bunzl', item_number: '75003678', distributor_item_name: 'GELATI SPOONS (1000)' },
  { name: 'Sample Spoons', distributor: 'bunzl', item_number: '75000073', distributor_item_name: '3in TASTER/SAMPLING SPOONS' },
  { name: 'Small Straws', distributor: 'other' },
  { name: 'Large Straws', distributor: 'bunzl', item_number: 'M9260052', distributor_item_name: 'GIANT PAPER STRAW CLEAR 9in' },
  // Topping Containers
  { name: "Rita's Logo Topping Cups", distributor: 'bunzl', item_number: '12500428', distributor_item_name: '2 OZ SOUFFLE CUP PLASTIC' },
  { name: 'Translucent Plastic Topping Cups', distributor: 'bunzl', item_number: '12500428', distributor_item_name: '2 OZ SOUFFLE CUP PLASTIC' },
  { name: 'Paper Souffle/Sample Cups', distributor: 'bunzl', item_number: '18202614', distributor_item_name: '1 OZ PAPER SOUFFLE CUP (5000)' },
  // Toppings - Dry
  { name: 'Graham Crackers', distributor: 'discontinued' },
  { name: 'Nilla Wafers', distributor: 'bunzl', item_number: 'F1320000', distributor_item_name: 'WHOLE NILLA WAFERS' },
  { name: 'M&Ms', distributor: 'bunzl', item_number: 'A4510360', distributor_item_name: "M&M MINI'S (2/4 LB)" },
  { name: 'Peppermint', distributor: 'discontinued' },
  { name: 'Peanuts', distributor: 'balford', item_number: '7562', distributor_item_name: 'TR-PEANUTS-CHOPPED' },
  { name: 'Gummy Bears', distributor: 'balford', item_number: '7068', distributor_item_name: 'MINI GUMI BEAR' },
  { name: 'Oreo Pieces', distributor: 'bunzl', item_number: 'F8870014', distributor_item_name: 'OREO PIECES (4/2.5lb)' },
  { name: 'Chocolate Sprinkles', distributor: 'bunzl', item_number: 'G0680002', distributor_item_name: 'CHOCOLATE SPRINKLES (25LB)' },
  { name: 'Rainbow Sprinkles', distributor: 'bunzl', item_number: 'G0680001', distributor_item_name: 'RAINBOW SPRINKLES (25LB)' },
  { name: 'Glitter Sprinkles', distributor: 'bunzl', item_number: 'M95700001', distributor_item_name: 'UNICORN SPARKLE SPRINKLES 14OZ' },
  { name: "Reese's Cups", distributor: 'balford', item_number: '7059', distributor_item_name: 'REESES PB CUPS' },
  { name: 'Chocolate Chips', distributor: 'balford', item_number: '7050', distributor_item_name: 'NESTLE MINI CHOC CHIPS 25LB' },
  { name: 'Take 5', distributor: 'discontinued' },
  { name: 'Cookie Dough Bites', distributor: 'balford', item_number: '7051', distributor_item_name: 'CC COOKIE DOUGH' },
  { name: 'Brownie Bites', distributor: 'balford', item_number: '7053', distributor_item_name: 'FUDGE BROWNIE BITS (20LB)' },
  { name: 'Unicorn Bark', distributor: 'discontinued' },
  { name: 'Baby Nerds', distributor: 'balford', item_number: '7056', distributor_item_name: 'BABY NERDS RAINBOW 2-5LB' },
  { name: 'Regular Nerds', distributor: 'discontinued' },
  { name: 'Skittles', category: 'Toppings - Dry', distributor: 'discontinued' },
  { name: 'Almond Roca', distributor: 'balford', item_number: '7097', distributor_item_name: 'CHOPPED ALMOND ROCA 2-5LB' },
  { name: 'Andes', distributor: 'balford', item_number: '7006', distributor_item_name: 'ANDES MINTS' },
  { name: 'Tajin', distributor: 'bunzl', item_number: 'L59900031', distributor_item_name: 'TAJIN SEASONING 5-OZ' },
  { name: 'Tamarind Candy', distributor: 'other' },
  { name: 'Brownies (for sundaes)', distributor: 'discontinued' },
  // Toppings - Wet
  { name: 'Peanut Butter Topping', distributor: 'balford', item_number: '7078', distributor_item_name: 'PB SAUCE 6/4.5#/CS' },
  { name: 'Crushed Cherries', distributor: 'bunzl', item_number: '53790011', distributor_item_name: 'CRUSHED CHERRIES (6-1/2 GAL)' },
  { name: 'Diced Black Cherries', distributor: 'bunzl', item_number: 'N1370000', distributor_item_name: 'DICED CHERRIES' },
  { name: 'Apple Topping', distributor: 'bunzl', item_number: '53790092', distributor_item_name: 'APPLE PIE TOPPING' },
  { name: 'Strawberry Topping', distributor: 'bunzl', item_number: '53790138', distributor_item_name: 'STRAWBERRY TOPPING' },
  { name: 'Pumpkin Cream Topping', distributor: 'bunzl', item_number: '53790149', distributor_item_name: 'PUMPKIN CREME' },
  { name: 'Whole Cherries', distributor: 'bunzl', item_number: 'N1370002', distributor_item_name: 'WHOLE MARASCHINO CHERRIES' },
  { name: 'Pineapple Topping', distributor: 'bunzl', item_number: '53790084', distributor_item_name: 'CRUSHED PINEAPPLES' },
  { name: 'Caramel', distributor: 'balford', item_number: '7074', distributor_item_name: 'CARAMEL POUCHES 4/48oz' },
  { name: 'Hot Fudge', distributor: 'other' },
  { name: 'Whipped Cream', distributor: 'balford', item_number: '2086', distributor_item_name: 'WHIP CREAM (1 CASE)' },
  { name: 'Nacho Cheese', distributor: 'other' },
  { name: 'Chamoy', distributor: 'other' },
  // Syrups
  { name: 'Banana', category: 'Syrups', distributor: 'bunzl', item_number: 'L6390026', distributor_item_name: 'BANANA CUSTARD FLAVOR' },
  { name: 'Black Raspberry', distributor: 'bunzl', item_number: 'L6390020', distributor_item_name: 'BLACK RASP FLAVOR' },
  { name: 'Butter Pecan', distributor: 'bunzl', item_number: 'L6390021', distributor_item_name: 'BUTTER PECAN FLAVOR' },
  { name: 'Cake Batter', distributor: 'bunzl', item_number: 'L6390016', distributor_item_name: 'CAKE BATTER FLAVOR' },
  { name: "Campfire S'mores", distributor: 'bunzl', item_number: 'L6390000', distributor_item_name: 'CAMPFIRE SMORE CUSTARD FLAVOR' },
  { name: 'Cheesecake', category: 'Syrups', distributor: 'bunzl', item_number: 'L6390022', distributor_item_name: 'CHEESECAKE FLAVOR' },
  { name: 'Coffee', distributor: 'bunzl', item_number: 'L6390018', distributor_item_name: 'COFFEE FLAVOR' },
  { name: 'Cotton Candy', category: 'Syrups', distributor: 'bunzl', item_number: '53790144', distributor_item_name: 'COTTON CANDY MIX' },
  { name: 'Mint', distributor: 'bunzl', item_number: 'L6390017', distributor_item_name: 'MINT FLAVOR' },
  { name: 'Peach', distributor: 'discontinued' },
  { name: 'Pistachio', distributor: 'discontinued' },
  { name: 'Pumpkin', category: 'Syrups', distributor: 'bunzl', item_number: '53790091', distributor_item_name: 'PUMPKIN MIX (4/1GAL)' },
  { name: 'Strawberry', category: 'Syrups', distributor: 'bunzl', item_number: '53790132', distributor_item_name: 'STRAWBERRY MIX (4/1GAL)' },
  // Ice Mix
  { name: 'Banana / Banana Split', distributor: 'bunzl', item_number: '53790068', distributor_item_name: 'BANANA/BANANA SPLIT CREAM MIX' },
  { name: 'Birthday Cake', distributor: 'bunzl', item_number: '53790087', distributor_item_name: 'BIRTHDAY CAKE MIX' },
  { name: 'Blue Raspberry', distributor: 'bunzl', item_number: '53790134', distributor_item_name: 'BLUEBERRY/BLUE RASP (4/1GAL)' },
  { name: 'Cheesecake', category: 'Ice Mix', distributor: 'bunzl', item_number: 'L6390022', distributor_item_name: 'CHEESECAKE FLAVOR' },
  { name: 'Cherry', distributor: 'bunzl', item_number: '53790056', distributor_item_name: 'CHERRY MIX (4/1GAL)' },
  { name: 'Clementine', distributor: 'bunzl', item_number: 'J3950012', distributor_item_name: 'CLEMENTINE JUG' },
  { name: 'Cola', distributor: 'seasonal' },
  { name: 'Coconut Cream', distributor: 'bunzl', item_number: '53790049', distributor_item_name: 'COCONUT CREAM MIX (4/1GAL)' },
  { name: 'Cookies N Cream', distributor: 'bunzl', item_number: '53790061', distributor_item_name: 'COOKIES N CREAM MIX' },
  { name: 'Cotton Candy', category: 'Ice Mix', distributor: 'bunzl', item_number: '53790144', distributor_item_name: 'COTTON CANDY MIX' },
  { name: 'Georgia Peach', distributor: 'bunzl', item_number: '53790088', distributor_item_name: 'GEORGIA PEACH MIX' },
  { name: 'Green Apple', distributor: 'bunzl', item_number: '53790066', distributor_item_name: 'GREEN APPLE MIX (4/1 GAL)' },
  { name: 'Gummy Bear', distributor: 'bunzl', item_number: '53790155', distributor_item_name: 'GUMMY BEAR WATER ICE MIX' },
  { name: 'Island Fusion', distributor: 'bunzl', item_number: '53790086', distributor_item_name: 'ISLAND FUSION MIX' },
  { name: 'Key Lime', distributor: 'bunzl', item_number: '53790089', distributor_item_name: 'KEY LIME MIX (4/1GAL)' },
  { name: 'Koolaid Sharkleberry', distributor: 'bunzl', item_number: 'J3950011', distributor_item_name: 'KOOLAID SHARKLEBERRY ICE' },
  { name: 'Koolaid Tropical Punch', distributor: 'bunzl', item_number: 'J3950008', distributor_item_name: 'KOOL-AID TROPICAL PUNCH' },
  { name: 'Lemon', distributor: 'bunzl', item_number: '53790030', distributor_item_name: 'LEMON BASE (4/1GAL)' },
  { name: 'Mango', distributor: 'bunzl', item_number: '53790032', distributor_item_name: 'MANGO MIX (4/1GAL)' },
  { name: 'Mint Chip', distributor: 'bunzl', item_number: '53790010', distributor_item_name: 'MINT CHOC CHIP CRM MIX' },
  { name: 'Passionfruit Paloma', distributor: 'bunzl', item_number: 'J3950013', distributor_item_name: 'PASSIONFRUIT PALOMA JUG' },
  { name: 'Pina Colada', distributor: 'bunzl', item_number: '53790036', distributor_item_name: 'PINA COLADA MIX (4/1GAL)' },
  { name: 'Pineapple', category: 'Ice Mix', distributor: 'bunzl', item_number: '53790097', distributor_item_name: 'PINEAPPLE ICE MIX' },
  { name: 'Purple Candy', distributor: 'seasonal' },
  { name: 'Pumpkin', category: 'Ice Mix', distributor: 'bunzl', item_number: '53790091', distributor_item_name: 'PUMPKIN MIX (4/1GAL)' },
  { name: 'Raspberry', distributor: 'bunzl', item_number: '53790125', distributor_item_name: 'RASPBERRY MIX (4/1GAL)' },
  { name: 'Root Beer', distributor: 'bunzl', item_number: '53790037', distributor_item_name: 'ROOT BEER MIX (4/1GAL)' },
  { name: 'Skittles', category: 'Ice Mix', distributor: 'discontinued' },
  { name: "S'mores", distributor: 'bunzl', item_number: '53790131', distributor_item_name: "S'MORES MIX (4/1GAL)" },
  { name: 'Sour Patch Watermelon', distributor: 'bunzl', item_number: '53790000', distributor_item_name: 'SOUR PATCH KIDS WATERMELON MIX' },
  { name: 'Swedish Fish', distributor: 'bunzl', item_number: '53790145', distributor_item_name: 'SWEDISH FISH MIX' },
  { name: 'Strawberry', category: 'Ice Mix', distributor: 'bunzl', item_number: '53790132', distributor_item_name: 'STRAWBERRY MIX (4/1GAL)' },
  { name: 'Vanilla', distributor: 'bunzl', item_number: '53790133', distributor_item_name: 'VANILLA MIX (4/1GAL)' },
  { name: 'Watermelon', distributor: 'bunzl', item_number: '53790135', distributor_item_name: 'WATERMELON MIX (4/1GAL)' },
  { name: 'Wild Cherry', distributor: 'bunzl', item_number: '53790065', distributor_item_name: 'WILD BLACK CHERRY MIX' },
  { name: 'Peeps', distributor: 'bunzl', item_number: 'J3950014', distributor_item_name: 'MYSTERY PEEPS' },
  { name: 'Chocolate', category: 'Ice Mix', distributor: 'bunzl', item_number: '53790117', distributor_item_name: 'CHOCOLATE MIX (4/1GAL)' },
  // Custard
  { name: 'Vanilla Custard Bags', distributor: 'balford', item_number: '2446', distributor_item_name: 'RITAS CUST VAN 5GAL' },
  { name: 'Chocolate Custard Bags', distributor: 'balford', item_number: '2447', distributor_item_name: 'RITAS CUST CHOC 5GAL' },
  // Things to Make Ice
  { name: 'Sugar', distributor: 'bunzl', item_number: 'G6670004', distributor_item_name: 'SUGAR BUNDLE (1/25# BAG)' },
  { name: 'Cream Ice Powder', distributor: 'bunzl', item_number: 'K1700001', distributor_item_name: 'CREAM ICE POWDER (10LBS)' },
  { name: 'Chocolate Base', distributor: 'bunzl', item_number: '53790082', distributor_item_name: 'CHOCOLATE BASE (2/.5GAL)' },
  { name: 'Lemon Concentrate', distributor: 'balford', item_number: '7401', distributor_item_name: 'FRZ LEMON MIX' },
  { name: 'Lime Concentrate', distributor: 'balford', item_number: '7402', distributor_item_name: 'FRZ LIME MIX' },
  { name: 'Milkshake Syrup', distributor: 'bunzl', item_number: '53790002', distributor_item_name: 'MILKSHAKE SYRUP (3-1/2 GAL)' },
  // Cones
  { name: 'Waffle Cones', distributor: 'bunzl', item_number: '41665576', distributor_item_name: 'JOY JACKETED WAFFLE CONES (216)' },
  { name: 'Cake Cones', distributor: 'bunzl', item_number: '41665427', distributor_item_name: 'JACKETED CAKE CONES (600)' },
  { name: 'Waffle Bowls', distributor: 'bunzl', item_number: '41660011', distributor_item_name: 'WAFFLE BOWLS (60)' },
  // Bags & Carriers
  { name: 'Cookie Bags', distributor: 'other' },
  { name: 'Plastic Bags', distributor: 'bunzl', item_number: '52490168', distributor_item_name: 'LOGOED T-SAC BAG' },
  { name: "Small Rita's Paper Bags", distributor: 'bunzl', item_number: '10060201', distributor_item_name: "RITA'S SMALL PAPER BAG" },
  { name: "Large Rita's Paper Bags", distributor: 'bunzl', item_number: '10060200', distributor_item_name: "RITA'S LARGE PAPER BAG" },
  { name: 'Drink Carriers', distributor: 'bunzl', item_number: 'M9560000', distributor_item_name: "RITA'S 4-CUP CARRIER" },
  // Napkins & Paper
  { name: 'White Napkins', distributor: 'bunzl', item_number: '14100865', distributor_item_name: 'TORK XPRESS NAPKIN' },
  { name: 'Paper Towels', distributor: 'bunzl', item_number: '78000008', distributor_item_name: 'PAPER TOWEL (30/RLS)' },
  // Cleaning Supplies
  { name: 'Hand Soap', distributor: 'bunzl', item_number: '75004229', distributor_item_name: 'HANDS-FREE FOAM SOAP' },
  { name: 'Sanitizer', distributor: 'bunzl', item_number: '35409202', distributor_item_name: 'HANDS FREE SANITIZER REFILLS' },
  { name: 'Dish Soap', distributor: 'bunzl', item_number: '52342901', distributor_item_name: 'PALMOLIVE HAND DISHWASH 1 GAL' },
  // Trash Bags
  { name: 'Black Trash Bags', distributor: 'bunzl', item_number: '78000096', distributor_item_name: 'LARGE TRASH LINER (200/PK)' },
  // Drink Items
  { name: 'Cold Brew Concentrate', distributor: 'balford', item_number: '7260', distributor_item_name: 'COLD BREW COFFEE CONCENTRATE' },
  { name: 'Matcha Syrup', distributor: 'balford', item_number: '7289', distributor_item_name: 'MATCHA GREEN TEA CON 4/1L' },
]

export async function POST() {
  const db = getServerSupabase()

  // Add columns if they don't exist (Supabase will ignore if already there)
  const errors: string[] = []
  let updated = 0

  for (const u of updates) {
    const query = db.from('items').update({
      distributor: u.distributor,
      item_number: u.item_number ?? null,
      distributor_item_name: u.distributor_item_name ?? null,
    }).eq('name', u.name)

    if (u.category) query.eq('category', u.category)

    const { error } = await query
    if (error) errors.push(`${u.name}: ${error.message}`)
    else updated++
  }

  return NextResponse.json({ updated, errors })
}
