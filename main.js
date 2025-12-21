const studentIds = ["24l35a4306", "24l35a4309", "24l767"];

const params = new URLSearchParams({
  teacher_id: "121319",
  password: "121319",
  studentIds: JSON.stringify(studentIds)
});

fetch(`http://localhost:3000/get_student_profile?${params}`)
  .then(r => r.text())
  .then(console.log);
