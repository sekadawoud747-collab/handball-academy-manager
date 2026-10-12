const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
initializeApp();
const db = getFirestore();

async function requireManager(request) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'يجب تسجيل الدخول أولاً');
  const snap = await db.collection('users').doc(request.auth.uid).get();
  if (!snap.exists || snap.data().role !== 'manager' || snap.data().active !== true) {
    throw new HttpsError('permission-denied', 'هذه العملية للمدير فقط');
  }
}

exports.createCoach = onCall(async (request) => {
  await requireManager(request);
  const { name, email, password, phone = '', teamId } = request.data || {};
  if (typeof name !== 'string' || !name.trim() || typeof email !== 'string' || !email.trim() ||
      typeof password !== 'string' || password.length < 6 || typeof teamId !== 'string' || !teamId) {
    throw new HttpsError('invalid-argument', 'الاسم والبريد وكلمة المرور والفريق مطلوبة');
  }
  const teamRef = db.collection('teams').doc(teamId);
  const team = await teamRef.get();
  if (!team.exists) throw new HttpsError('not-found', 'الفريق غير موجود');
  let user;
  try { user = await getAuth().createUser({ email: email.trim(), password, displayName: name.trim(), disabled: false }); }
  catch (e) { throw new HttpsError('already-exists', 'تعذر إنشاء الحساب؛ ربما البريد مستخدم بالفعل'); }
  try {
    const batch = db.batch();
    batch.set(db.collection('users').doc(user.uid), {
      role: 'coach', active: true, name: name.trim(), email: email.trim(), phone: String(phone || '').trim(),
      teamId, createdAt: FieldValue.serverTimestamp(), createdBy: request.auth.uid
    });
    batch.set(teamRef, { coachId: user.uid }, { merge: true });
    await batch.commit();
    return { uid: user.uid, email: user.email };
  } catch (e) {
    await getAuth().deleteUser(user.uid).catch(() => {});
    throw new HttpsError('internal', 'تعذر حفظ صلاحيات الكابتن');
  }
});

exports.deleteCoach = onCall(async (request) => {
  await requireManager(request);
  const uid = request.data && request.data.uid;
  if (typeof uid !== 'string' || !uid) throw new HttpsError('invalid-argument', 'معرّف الكابتن مطلوب');
  const ref = db.collection('users').doc(uid);
  const snap = await ref.get();
  if (!snap.exists || snap.data().role !== 'coach') throw new HttpsError('not-found', 'حساب الكابتن غير موجود');
  const batch = db.batch();
  batch.delete(ref);
  const teams = await db.collection('teams').where('coachId', '==', uid).get();
  teams.docs.forEach(doc => batch.set(doc.ref, { coachId: '' }, { merge: true }));
  await batch.commit();
  await getAuth().deleteUser(uid).catch(() => {});
  return { ok: true };
});
