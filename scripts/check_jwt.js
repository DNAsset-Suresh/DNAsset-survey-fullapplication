const token=process.env.CHECK_ACCESS_TOKEN;
if(!token)throw Error('Set CHECK_ACCESS_TOKEN to test an existing local session. Tokens are never printed.');
const response=await fetch('http://localhost:3000/api/me',{headers:{Authorization:'Bearer '+token}});
console.log('Session validation HTTP status:',response.status);
