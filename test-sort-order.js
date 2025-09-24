const data = require('./data/user-registrations.json');

const sorted = data.sort((a,b) => {
  const dateA = new Date(a.date);
  const dateB = new Date(b.date);

  if (dateA.getTime() === dateB.getTime()) {
    if (a.mealType === 'dinner' && b.mealType === 'lunch') return -1;
    if (a.mealType === 'lunch' && b.mealType === 'dinner') return 1;
    return 0;
  }

  return dateB.getTime() - dateA.getTime();
});

console.log('按当前排序逻辑展示前10条:');
sorted.slice(0,10).forEach((r,i) => {
  const mealName = r.mealType === 'lunch' ? '午餐' : '晚餐';
  console.log(`${i+1}. ${r.date} ${mealName} - ${r.dishName} (${r.restaurantName || '无'})`);
});