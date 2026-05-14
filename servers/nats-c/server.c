#define _GNU_SOURCE
#include <arpa/inet.h>
#include <netinet/in.h>
#include <pthread.h>
#include <stdbool.h>
#include <stdio.h>
#include <signal.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <unistd.h>

#define MAX_CLIENTS 1024
#define MAX_SUBS 1024
#define MAX_PAYLOAD (1024 * 1024)

typedef struct { char subject[256], queue[128], sid[128]; int delivered, max; } Sub;
typedef struct { int id, fd; bool verbose, echo, headers, closed; pthread_mutex_t wmu; Sub subs[MAX_SUBS]; int sub_count; } Client;
typedef struct { char key[384]; int cursor; } Cursor;
static Client *clients[MAX_CLIENTS]; static Cursor cursors[4096]; static int cursor_count=0, next_id=1; static pthread_mutex_t broker_mu=PTHREAD_MUTEX_INITIALIZER;

static void send_all(int fd,const void *buf,size_t n){ const char *p=buf; while(n){ ssize_t w=send(fd,p,n,0); if(w<=0)return; p+=w; n-=w; }}
static void send_str(int fd,const char*s){ send_all(fd,s,strlen(s)); }
static bool subject_matches(const char *pat,const char *subj){ char p[256],s[256],*pt,*st,*ps,*ss; strncpy(p,pat,255); strncpy(s,subj,255); p[255]=s[255]=0; pt=strtok_r(p,".",&ps); st=strtok_r(s,".",&ss); int matched=0; while(pt){ if(strcmp(pt,">")==0) return matched==0||st!=NULL; if(!st) return false; if(strcmp(pt,"*")&&strcmp(pt,st)) return false; matched++; pt=strtok_r(NULL,".",&ps); st=strtok_r(NULL,".",&ss);} return st==NULL; }
static int cursor_for(const char*k){ for(int i=0;i<cursor_count;i++) if(!strcmp(cursors[i].key,k)) return i; if(cursor_count<4096){ snprintf(cursors[cursor_count].key,sizeof(cursors[cursor_count].key),"%s",k); cursors[cursor_count].cursor=0; return cursor_count++; } return 0; }
static void ok(Client*c){ if(c->verbose) send_str(c->fd,"+OK\r\n"); }
static void prune(Client*c){ int w=0; for(int i=0;i<c->sub_count;i++) if(c->subs[i].max!=0) c->subs[w++]=c->subs[i]; c->sub_count=w; }
static void deliver(Client*c,Sub*s,const char*subject,const char*reply,const char*payload,int size){ char hdr[512]; pthread_mutex_lock(&c->wmu); if(reply&&*reply) snprintf(hdr,sizeof(hdr),"MSG %s %s %s %d\r\n",subject,s->sid,reply,size); else snprintf(hdr,sizeof(hdr),"MSG %s %s %d\r\n",subject,s->sid,size); send_str(c->fd,hdr); send_all(c->fd,payload,size); send_str(c->fd,"\r\n"); pthread_mutex_unlock(&c->wmu); s->delivered++; if(s->max>=0&&s->delivered>=s->max) s->max=0; }
static void publish(Client*pub,const char*subject,const char*reply,const char*payload,int size){ int qci[MAX_CLIENTS*4],qsi[MAX_CLIENTS*4],qn=0; char qkey[384]=""; pthread_mutex_lock(&broker_mu); for(int i=0;i<MAX_CLIENTS;i++){ Client*c=clients[i]; if(!c||c->closed||(!pub->echo&&c==pub)) continue; for(int j=0;j<c->sub_count;j++){ Sub*s=&c->subs[j]; if(!subject_matches(s->subject,subject)) continue; if(s->queue[0]){ char k[384]; snprintf(k,sizeof(k),"%s\1%s",s->subject,s->queue); if(!qkey[0]) snprintf(qkey,sizeof(qkey),"%s",k); if(!strcmp(qkey,k)&&qn<MAX_CLIENTS*4){ qci[qn]=i; qsi[qn++]=j; } } else deliver(c,s,subject,reply,payload,size); } prune(c); } if(qn){ int ci=cursor_for(qkey), pick=cursors[ci].cursor++%qn; Client*c=clients[qci[pick]]; if(c&&qsi[pick]<c->sub_count){ deliver(c,&c->subs[qsi[pick]],subject,reply,payload,size); prune(c);} } pthread_mutex_unlock(&broker_mu); }
static int read_line(int fd,char*out,int cap){ int n=0; char ch; while(n<cap-1){ ssize_t r=recv(fd,&ch,1,0); if(r<=0) return -1; if(ch=='\n') break; if(ch!='\r') out[n++]=ch; } out[n]=0; return n; }
static bool read_exact(int fd,char*buf,int n){ int got=0; while(got<n){ ssize_t r=recv(fd,buf+got,n-got,0); if(r<=0) return false; got+=r; } return true; }
static void remove_client(Client*c){ pthread_mutex_lock(&broker_mu); for(int i=0;i<MAX_CLIENTS;i++) if(clients[i]==c) clients[i]=NULL; c->closed=true; pthread_mutex_unlock(&broker_mu); close(c->fd); pthread_mutex_destroy(&c->wmu); free(c); }
static void *handle(void*arg){ Client*c=arg; char line[65536]; for(;;){ if(read_line(c->fd,line,sizeof(line))<0) break; char orig[65536]; snprintf(orig,sizeof(orig),"%s",line); char*tok[6]={0}; int n=0; for(char*p=strtok(line," ");p&&n<6;p=strtok(NULL," ")) tok[n++]=p; if(!n) continue; if(!strcasecmp(tok[0],"PING")){send_str(c->fd,"PONG\r\n"); continue;} if(!strcasecmp(tok[0],"PONG")){ok(c); continue;} if(!strcasecmp(tok[0],"CONNECT")){c->verbose=strstr(orig,"\"verbose\":true"); c->echo=!strstr(orig,"\"echo\":false"); c->headers=strstr(orig,"\"headers\":true"); ok(c); continue;} if(!strcasecmp(tok[0],"SUB")&&(n==3||n==4)){pthread_mutex_lock(&broker_mu); if(c->sub_count<MAX_SUBS){Sub*s=&c->subs[c->sub_count++]; memset(s,0,sizeof(*s)); snprintf(s->subject,sizeof(s->subject),"%s",tok[1]); if(n==4){snprintf(s->queue,sizeof(s->queue),"%s",tok[2]); snprintf(s->sid,sizeof(s->sid),"%s",tok[3]);} else snprintf(s->sid,sizeof(s->sid),"%s",tok[2]); s->max=-1;} pthread_mutex_unlock(&broker_mu); ok(c); continue;} if(!strcasecmp(tok[0],"UNSUB")&&(n==2||n==3)){pthread_mutex_lock(&broker_mu); for(int i=0;i<c->sub_count;i++) if(!strcmp(c->subs[i].sid,tok[1])) c->subs[i].max=n==3?atoi(tok[2]):0; prune(c); pthread_mutex_unlock(&broker_mu); ok(c); continue;} if((!strcasecmp(tok[0],"PUB")&&(n==3||n==4))||(!strcasecmp(tok[0],"HPUB")&&(n==4||n==5))){ bool hp=!strcasecmp(tok[0],"HPUB"); int h=hp?atoi(tok[n-2]):0, total=atoi(tok[n-1]); if(total<0||total>MAX_PAYLOAD||h>total){send_str(c->fd,"-ERR 'Maximum Payload Violation'\r\n"); break;} char*p=malloc(total+2); if(!p||!read_exact(c->fd,p,total+2)){free(p); break;} publish(c,tok[1],(n==4&&!hp)||(n==5&&hp)?tok[2]:"",p+h,total-h); free(p); ok(c); continue;} send_str(c->fd,"-ERR 'Invalid Protocol'\r\n"); break; } remove_client(c); return NULL; }
int main(int argc,char**argv){ signal(SIGPIPE, SIG_IGN); int port=argc>1?atoi(argv[1]):4222; int l=socket(AF_INET,SOCK_STREAM,0), one=1; setsockopt(l,SOL_SOCKET,SO_REUSEADDR,&one,sizeof(one)); struct sockaddr_in a={.sin_family=AF_INET,.sin_addr.s_addr=INADDR_ANY,.sin_port=htons(port)}; if(bind(l,(struct sockaddr*)&a,sizeof(a))||listen(l,256)){perror("listen"); return 1;} fprintf(stderr,"universal-queues C NATS core server listening on 0.0.0.0:%d\n",port); for(;;){ int fd=accept(l,NULL,NULL); if(fd<0) continue; Client*c=calloc(1,sizeof(Client)); c->fd=fd; c->echo=true; pthread_mutex_init(&c->wmu,NULL); pthread_mutex_lock(&broker_mu); c->id=next_id++; for(int i=0;i<MAX_CLIENTS;i++) if(!clients[i]){clients[i]=c; break;} pthread_mutex_unlock(&broker_mu); char info[512]; snprintf(info,sizeof(info),"INFO {\"server_id\":\"UCNATS000000000000000001\",\"server_name\":\"universal-queues-c\",\"version\":\"0.1.0\",\"proto\":1,\"host\":\"0.0.0.0\",\"port\":%d,\"headers\":true,\"max_payload\":%d}\r\n",port,MAX_PAYLOAD); send_str(fd,info); pthread_t t; pthread_create(&t,NULL,handle,c); pthread_detach(t); } }
