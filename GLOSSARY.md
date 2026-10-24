# AccessiBU

AccessiBU keeps a shared record of physical hazards so people on campus can see what is in the way and facilities can be told.

## Language

**Member**:
A person with a @bu.edu email address who reports and browses hazards.
_Avoid_: Student, user, account

**Role**:
A label on a Member: member or admin.
_Avoid_: account type, user type

**Mobility preference**:
A Member's stated need for a barrier-free path.
_Avoid_: accessibility mode

**Hazard**:
A real-world condition at a place, described by one or more Reports. It stays open until a Member marks it resolved, and if that condition returns it is a new Hazard.
_Avoid_: Issue, problem, pin

**Report**:
One submission from one Member about a Hazard, either a photo or text, and it cannot be withdrawn. A photo Report has a hazard type, a numeric category, and a summary. A text Report has a hazard type, a numeric category, and a description.
_Avoid_: Pin, ticket

**Hazard type**:
The kind of condition a Report describes: spill, blockage, elevator, entrance, walking surface, or other.
_Avoid_: category, label

**Category**:
The numeric code on a Report, alongside its hazard type.
_Avoid_: label, type

**Severity**:
A score from 0 to 100 on a Hazard for how much the condition interferes with passage. Higher means more blocked. A photo’s score comes from classification, and a text submission supplies the score directly.
_Avoid_: low, medium, high, label

**Summary**:
The short account of what a photo Report shows.
_Avoid_: caption

**Description**:
The text a Member writes in a text Report.
_Avoid_: comment, note

**Facilities**:
The campus organization responsible for repairing Hazards.
_Avoid_: operator, admin

**Alert**:
The single notice Facilities receives for a new Hazard. It goes out once a photo Report has its category, or as soon as a text Report opens the Hazard.
_Avoid_: ticket, work order
