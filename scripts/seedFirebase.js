import { firestoreDb, firebaseAuth } from '../backend/src/services/firebase.js';
import { collection, doc, setDoc, getDocs } from 'firebase/firestore';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile } from 'firebase/auth';

const categories = [
  {
    id: '671c3c57-5f93-401b-aa43-42097ec4f522',
    name: 'Title Documents',
    description: 'Registered deeds and the chain of title.',
    display_order: 1,
    is_active: true
  },
  {
    id: '6c8f7d26-9931-4d21-8d9c-a9e98c9dbe5a',
    name: 'Field Measurement Book (FMB)',
    description: 'Survey sketch and field measurements.',
    display_order: 2,
    is_active: true
  },
  {
    id: '57da0f1b-1649-4840-b3f0-9fdf4388f586',
    name: 'Patta',
    description: 'Revenue record for the property.',
    display_order: 3,
    is_active: true
  },
  {
    id: '144eede7-795f-4a6c-80b3-9a1ff423493f',
    name: 'Encumbrance Certificate (EC)',
    description: 'Recorded transactions and encumbrances.',
    display_order: 4,
    is_active: true
  },
  {
    id: 'e3e5f0d1-e221-4a72-8b35-71ee51171865',
    name: 'Adangal',
    description: 'Land use and cultivation record.',
    display_order: 5,
    is_active: true
  },
  {
    id: '9424b345-39c0-48b9-aa4c-42322f0a2dfe',
    name: 'Government Pleader Legal Opinion',
    description: 'Legal review by the appropriate qualified professional.',
    display_order: 6,
    is_active: true
  },
  {
    id: '0c3e9297-bcb8-4ccb-90c6-ec0af9e3e8d5',
    name: 'A-Register',
    description: 'Village land and revenue register.',
    display_order: 7,
    is_active: true
  }
];

const users = [
  {
    id: '10000000-0000-4000-8000-000000000001',
    email: 'admin@dnassets.com',
    password: 'admin123',
    role: 'admin',
    full_name: 'DNAssets Administrator'
  },
  {
    id: '10000000-0000-4000-8000-000000000007',
    email: 'dna.callus@gmail.com',
    password: 'dna.suresh123',
    role: 'admin',
    full_name: 'DN Assets'
  },
  {
    id: '10000000-0000-4000-8000-000000000099',
    email: 'dna.space.sm@gmail.com',
    password: 'dnasurvey',
    role: 'admin',
    full_name: 'DNAssets Admin (dna.space.sm)'
  },
  {
    id: '10000000-0000-4000-8000-000000000005',
    email: 'founder@dnassets.com',
    password: 'founder123',
    role: 'admin',
    full_name: 'Founder'
  },
  {
    id: '10000000-0000-4000-8000-000000000003',
    email: 'reviewer@dnassets.com',
    password: 'naresh123',
    role: 'reviewer',
    full_name: 'Naresh'
  },
  {
    id: '10000000-0000-4000-8000-000000000008',
    email: 'user@dnassets.com',
    password: 'user123',
    role: 'user',
    full_name: 'Suresh'
  },
  {
    id: '10000000-0000-4000-8000-000000000004',
    email: 'viewer@dnassets.com',
    password: 'viewer123',
    role: 'viewer',
    full_name: 'DNAssets Viewer'
  }
];

async function seed() {
  console.log('Seeding Document Categories to Firestore...');
  for (const cat of categories) {
    const docRef = doc(firestoreDb, 'document_categories', cat.id);
    await setDoc(docRef, cat, { merge: true });
    console.log(`  ✓ Category: ${cat.name}`);
  }

  console.log('\nSeeding User Accounts & Profiles to Firebase...');
  for (const u of users) {
    let authUser = null;
    try {
      const cred = await createUserWithEmailAndPassword(firebaseAuth, u.email, u.password);
      authUser = cred.user;
      console.log(`  ✓ Created Auth User: ${u.email} (Firebase UID: ${authUser.uid})`);
    } catch (err) {
      if (err.code === 'auth/email-already-in-use') {
        const cred = await signInWithEmailAndPassword(firebaseAuth, u.email, u.password);
        authUser = cred.user;
        console.log(`  • Auth User exists: ${u.email} (Firebase UID: ${authUser.uid})`);
      } else {
        console.error(`  ✗ Error creating ${u.email}:`, err.message);
      }
    }

    if (authUser) {
      await updateProfile(authUser, { displayName: u.full_name }).catch(() => {});
    }

    const profileData = {
      id: u.id,
      firebase_uid: authUser?.uid || null,
      email: u.email,
      role: u.role,
      full_name: u.full_name,
      created_at: new Date().toISOString()
    };

    // Save by UUID and by firebase_uid for fast lookup
    await setDoc(doc(firestoreDb, 'profiles', u.id), profileData, { merge: true });
    if (authUser?.uid) {
      await setDoc(doc(firestoreDb, 'users', authUser.uid), profileData, { merge: true });
    }
    console.log(`  ✓ Saved Profile: ${u.full_name} (${u.role})`);
  }

  console.log('\nVerifying collections in Firestore...');
  const catSnap = await getDocs(collection(firestoreDb, 'document_categories'));
  console.log(`  Document Categories in Firestore: ${catSnap.docs.length}`);
  const profSnap = await getDocs(collection(firestoreDb, 'profiles'));
  console.log(`  Profiles in Firestore: ${profSnap.docs.length}`);
  console.log('\nFirebase seeding completed successfully!');
}

seed()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Seeding error:', err);
    process.exit(1);
  });

