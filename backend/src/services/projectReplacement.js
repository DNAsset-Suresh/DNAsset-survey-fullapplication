// Call only after verifying a separately stored database and document backup.
export async function replaceWithPondy(db){
  return db.transaction(async tx=>{
    const oldId='11111111-1111-4000-8000-000000000001';
    const old=(await tx.query('select * from projects where id=$1 for update',[oldId])).rows[0];
    if(!old||old.project_name!=='Green Valley'||old.archived_at)throw Error('Expected active Green Valley record was not found.');
    if((await tx.query("select id from projects where lower(project_name)='pondy'")).rows.length)throw Error('pondy already exists; refusing to create a duplicate.');
    const actor=(await tx.query("select id from profiles where role='admin' order by created_at,id limit 1")).rows[0]?.id;
    if(!actor)throw Error('An existing administrator is required.');
    const projectId=(await tx.query('select save_project($1,$2::jsonb) as id',[actor,JSON.stringify({project_name:'pondy',project_code:'12',village:'pondy',project_address:'pondy',promoter_name:'siva',status:'Active'})])).rows[0].id;
    await tx.query('update projects set owner_name=$1 where id=$2',['guna',projectId]);
    const propertyId=(await tx.query('select save_property($1,$2::jsonb) as id',[actor,JSON.stringify({project_id:projectId,survey_number:'231',property_name:'pondy',village:'pondy',owner_name:'guna',status:'Active'})])).rows[0].id;
    await tx.query('update projects set archived_at=now() where id=$1',[oldId]);
    await tx.query("insert into audit_logs(property_id,actor_id,action,new_values) values($1,$2,'project.replacement', $3::jsonb)",[propertyId,actor,JSON.stringify({archived_project_id:oldId,new_project_id:projectId,method:'Archive without deletion; user-requested replacement'})]);
    return {archivedProjectId:oldId,projectId,propertyId,projectName:'pondy',projectCode:'12',location:'pondy',owner:'guna',promoter:'siva',surveyNumber:'231',deletedRecords:0};
  });
}
