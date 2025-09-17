const fs = require('fs');
const path = require('path');

async function testUserIdSearch() {
  try {
    console.log('Testing recursive user ID search...');

    const dataPath = path.join(__dirname, 'data', 'daily-orders.json');
    const data = fs.readFileSync(dataPath, 'utf8');
    const orders = JSON.parse(data) || [];
    console.log(`Data loaded: ${orders.length} entries`);

    // Apply the same search logic from the fixed code
    const findUserId = (data) => {
      if (Array.isArray(data)) {
        for (const item of data) {
          const result = findUserId(item);
          if (result) return result;
        }
      } else if (data && typeof data === 'object') {
        if (data.userId) return data.userId;
        for (const value of Object.values(data)) {
          const result = findUserId(value);
          if (result) return result;
        }
      }
      return null;
    };

    const defaultUserId = findUserId(orders);

    if (defaultUserId) {
      console.log(`✅ Found user ID: ${defaultUserId}`);
      return { success: true, userId: defaultUserId };
    } else {
      console.log('❌ No user ID found');
      return { success: false, userId: null };
    }
  } catch (error) {
    console.error('❌ Test failed:', error);
    return { success: false, error: error.message };
  }
}

testUserIdSearch().then(result => {
  console.log('Test result:', result);
  process.exit(result.success ? 0 : 1);
});